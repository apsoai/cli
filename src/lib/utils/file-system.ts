import * as path from "path";
import * as fs from "fs";

const createDir = (dirname: string): void => {
  if (!fs.existsSync(dirname)) {
    fs.mkdirSync(dirname, { recursive: true });
  }
};
export const createFile = (file: string, content: string): void => {
  const dirname = path.dirname(file);
  createDir(dirname);
  fs.writeFileSync(file, content);
};

export const createDirectoryContents = (
  templatePath: string,
  newProjectPath: string,
  apiType: string
): void => {
  const filesToCreate = fs.readdirSync(templatePath);
  const CURR_DIR = process.cwd();

  filesToCreate.forEach((file) => {
    const origFilePath = `${templatePath}/${file}`;
    // get stats about the current file
    const stats = fs.statSync(origFilePath);

    if (stats.isFile()) {
      writeFile(
        file,
        origFilePath,
        `${CURR_DIR}/${newProjectPath}`,
        stats.mode,
        apiType
      );
    } else if (stats.isDirectory()) {
      fs.mkdirSync(`${CURR_DIR}/${newProjectPath}/${file}`);
      // recursive call
      createDirectoryContents(
        `${templatePath}/${file}`,
        `${newProjectPath}/${file}`,
        apiType
      );
    }
  });
};

const writeFile = (
  fileName: string,
  origFilePath: string,
  writePath: string,
  mode: number,
  apiType: string
) => {
  const contents = fs.readFileSync(origFilePath, "utf8");
  if (fileName.startsWith("app.module") && fileName.includes(apiType)) {
    fileName = "app.module.ts";
    const fileWritePath = `${writePath}/${fileName}`;
    fs.writeFileSync(fileWritePath, contents, "utf8");
    fs.chmodSync(fileWritePath, mode);
  } else if (!fileName.startsWith("app.module")) {
    if (fileName === ".npmignore") fileName = ".gitignore";
    const fileWritePath = `${writePath}/${fileName}`;
    fs.writeFileSync(fileWritePath, contents, "utf8");
    fs.chmodSync(fileWritePath, mode);
  }
};
