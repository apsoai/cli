import BaseCommand from '../../lib/base-command';
import { Flags } from '@oclif/core';
import { configManager } from '../../lib/config';
import { apiClient } from '../../lib/api-client';
import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import * as os from 'os';

interface PushRepositoryResponse {
  success: boolean;
  branch: string;
  message: string;
}

export default class ServicePush extends BaseCommand {
  static description = 'Push local code to service repository';

  static examples = [
    '$ apso service push --service-id 123',
    '$ apso service push --service-id 123 --branch develop --message "Update API"',
  ];

  static flags = {
    'service-id': Flags.integer({
      char: 's',
      required: true,
      description: 'Service ID',
    }),
    branch: Flags.string({
      char: 'b',
      default: 'main',
      description: 'Branch name (default: main)',
    }),
    message: Flags.string({
      char: 'm',
      default: 'Update from CLI',
      description: 'Commit message',
    }),
    'workspace-id': Flags.integer({
      char: 'w',
      description: 'Workspace ID (optional, uses default if not specified)',
    }),
  };

  /**
   * Get workspace ID from flags or config
   */
  private getWorkspaceId(workspaceId?: number): number {
    if (workspaceId) {
      return workspaceId;
    }

    const defaultWorkspaceId = configManager.getDefaultWorkspaceId();
    if (!defaultWorkspaceId) {
      this.error(
        'No workspace specified. Use --workspace-id or set a default workspace.'
      );
    }

    return defaultWorkspaceId;
  }

  /**
   * Create zip archive of project files
   */
  private async createZip(projectPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const tempDir = os.tmpdir();
      const zipPath = path.join(tempDir, `apso-push-${Date.now()}.zip`);

      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', {
        zlib: { level: 9 },
      });

      output.on('close', () => {
        this.log(`✓ Project packaged: ${zipPath} (${archive.pointer()} bytes)`);
        resolve(zipPath);
      });

      archive.on('error', (err: Error) => {
        reject(err);
      });

      archive.pipe(output);

      // Add files, excluding common ignore patterns
      const ignorePatterns = [
        'node_modules',
        '.git',
        '.next',
        'dist',
        'build',
        '.apso',
        '*.zip',
        '.DS_Store',
      ];

      const addDirectory = (dir: string, baseDir: string = dir) => {
        const files = fs.readdirSync(dir);

        for (const file of files) {
          const filePath = path.join(dir, file);
          const relativePath = path.relative(baseDir, filePath);
          const stat = fs.statSync(filePath);

          // Check if should be ignored
          const shouldIgnore = ignorePatterns.some((pattern) => {
            if (pattern.includes('*')) {
              return file.match(new RegExp(pattern.replace('*', '.*')));
            }
            return relativePath.includes(pattern) || file === pattern;
          });

          if (shouldIgnore) {
            continue;
          }

          if (stat.isDirectory()) {
            addDirectory(filePath, baseDir);
          } else {
            archive.file(filePath, { name: relativePath });
          }
        }
      };

      addDirectory(projectPath);
      archive.finalize();
    });
  }

  /**
   * Upload zip to S3 via backend
   */
  private async uploadToS3(
    zipPath: string,
    workspaceId: number,
    serviceId: number
  ): Promise<string> {
    try {
      this.log('Uploading to S3...');

      const FormData = require('form-data');
      const formData = new FormData();
      formData.append('file', fs.createReadStream(zipPath));

      // Use backend API directly for S3 upload
      const response = await apiClient.post<{ url: string }>(
        `/WorkspaceServices/${workspaceId}/${serviceId}/code/upload`,
        formData,
        {
          headers: formData.getHeaders(),
        }
      );

      this.log('✓ Upload complete');
      return response.url;
    } catch (error: any) {
      if (error instanceof Error) {
        throw new TypeError(`Failed to upload to S3: ${error.message}`);
      }
      throw error;
    }
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ServicePush);

    // Check authentication
    if (!configManager.isLoggedIn()) {
      this.error('Not logged in. Run "apso auth login" first.');
    }

    // Get workspace ID
    const workspaceId = this.getWorkspaceId(flags['workspace-id']);

    const projectPath = process.cwd();
    let zipPath: string | null = null;

    try {
      // Validate project directory
      if (!fs.existsSync(projectPath)) {
        this.error('Current directory does not exist');
      }

      this.log(`Packaging project from: ${projectPath}`);

      // Create zip
      zipPath = await this.createZip(projectPath);

      // Upload to S3
      const downloadUrl = await this.uploadToS3(
        zipPath,
        workspaceId,
        flags['service-id']
      );

      // Push to GitHub via backend
      this.log('Pushing to GitHub...');
      const pushResponse = await apiClient.post<PushRepositoryResponse>(
        `/github-connections/push-repository/${flags['service-id']}`,
        {
          branch: flags.branch,
          downloadUrl: downloadUrl,
          message: flags.message,
          serviceId: flags['service-id'],
          workspaceId: workspaceId,
        }
      );

      if (pushResponse.success) {
        this.log(`✓ Code pushed to ${pushResponse.branch} branch`);
        this.log(`  Message: ${pushResponse.message}`);
      } else {
        this.error('Push failed');
      }
    } catch (error: any) {
      if (error instanceof Error) {
        this.error(error.message);
      } else {
        this.error('Failed to push code');
      }
    } finally {
      // Cleanup zip file
      if (zipPath && fs.existsSync(zipPath)) {
        try {
          fs.unlinkSync(zipPath);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }
}

