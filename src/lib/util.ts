import * as path from "path";
import * as fs from "fs";

export const createDir = (dirname: string): void => {
  if (!fs.existsSync(dirname)) {
    fs.mkdirSync(dirname, { recursive: true });
  }
};
export const createFile = (file: string, content: string): void => {
  const dirname = path.dirname(file);
  createDir(dirname);
  fs.writeFileSync(file, content);
};

export const camelCase = (str: string): string =>
  str[0].toLowerCase() + str.slice(1);

export const createDirectoryContents = (
  templatePath: string,
  newProjectPath: string
): void => {
  const filesToCreate = fs.readdirSync(templatePath);
  const CURR_DIR = process.cwd();

  filesToCreate.forEach((file) => {
    const origFilePath = `${templatePath}/${file}`;

    // get stats about the current file
    const stats = fs.statSync(origFilePath);

    if (stats.isFile()) {
      const contents = fs.readFileSync(origFilePath, "utf8");

      // Rename
      if (file === ".npmignore") file = ".gitignore";

      const writePath = `${CURR_DIR}/${newProjectPath}/${file}`;
      fs.writeFileSync(writePath, contents, "utf8");
      fs.chmodSync(writePath, stats.mode);
    } else if (stats.isDirectory()) {
      fs.mkdirSync(`${CURR_DIR}/${newProjectPath}/${file}`);

      // recursive call
      createDirectoryContents(
        `${templatePath}/${file}`,
        `${newProjectPath}/${file}`
      );
    }
  });
};
