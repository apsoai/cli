import BaseCommand from '../../lib/base-command';
import { configManager } from '../../lib/config';

export default class Logout extends BaseCommand {
  static description = 'Log out and clear stored credentials';

  static examples = ['$ apso logout'];

  async run(): Promise<void> {
    if (!configManager.isLoggedIn()) {
      this.log('Not logged in. Nothing to do.');
      return;
    }

    try {
      configManager.clearConfig();
      this.log('✓ Successfully logged out');
    } catch (error: any) {
      this.error(`Failed to logout: ${error.message || 'Unknown error'}`);
    }
  }
}

