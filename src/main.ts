#!/usr/bin/env node

import fsOrigin, { Dirent, promises as fs } from 'fs';
import path from 'path';
import process from 'process';
import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import cliSpinners from 'cli-spinners';
import { getPathNames } from 'esm-pathnames';

const spinner = ora({ spinner: cliSpinners.material, stream: process.stdout });

const chalkError = chalk.red.bold;
const chalkSuccess = chalk.green;

const BUFFER_PATH = path.resolve(process.cwd(), './.replace-rr');

const checkFileExist = async (filePath: string) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const clearFile = async (filePath: string) => {
  try {
    await fs.rm(filePath, { recursive: true, force: true });
  } catch {
    throw new Error(`Can't clear ${filePath}`);
  }
};

const clearBuffer = async () => {
  if (await checkFileExist(BUFFER_PATH)) {
    await clearFile(BUFFER_PATH);
  }
};

const initBuffer = async () => {
  await clearBuffer();

  try {
    await fs.mkdir(BUFFER_PATH);
  } catch {
    throw new Error(`Failed to write buffer to ${BUFFER_PATH}`);
  }
};

const writeBuffer = async (originFilePath: string, data: string) => {
  if (!path.isAbsolute(originFilePath)) {
    const bufferPath = path.resolve(BUFFER_PATH, originFilePath);
    if (!(await checkFileExist(path.dirname(bufferPath)))) {
      await fs.mkdir(path.dirname(bufferPath), { recursive: true });
    }

    await fs.writeFile(bufferPath, data, { flag: 'wx' });

    return true;
  }

  throw new Error(
    `originFilePath must be a relative path. (${originFilePath})`,
  );
};

const replaceOriginWithBuffer = async (originPath: string) => {
  try {
    await fs.cp(BUFFER_PATH, originPath, {
      recursive: true,
      force: true,
    });
  } catch {
    throw new Error('Failed to replace the original path with a buffer.');
  }
};

interface IPackageInfo {
  version?: string;
  [key: string]: string | undefined;
}

const readPackageInfo = (): IPackageInfo => {
  const { __dirname } = getPathNames(import.meta);

  try {
    const fileContent = fsOrigin.readFileSync(
      path.resolve(__dirname, '../package.json'),
      {
        encoding: 'utf-8',
      },
    );

    return JSON.parse(fileContent);
  } catch {
    return {};
  }
};

program.version(readPackageInfo().version ?? '0.0.0');

async function* getFilePaths(targetDir: string): AsyncGenerator<string> {
  const dir = await fs.opendir(targetDir);

  let curEntry: Dirent | null = null;
  while ((curEntry = await dir.read())) {
    const wipEntryPath = path.resolve(dir.path, curEntry.name);

    if (curEntry.isDirectory()) {
      for await (const subFilePath of getFilePaths(wipEntryPath)) {
        yield subFilePath;
      }

      continue;
    }

    yield wipEntryPath;
  }

  await dir.close();
}

async function* getSpecificFiles(
  pred: (filePath: string) => boolean,
  targetDir: string,
) {
  for await (const filePath of getFilePaths(targetDir)) {
    if (!pred(filePath)) {
      continue;
    }

    yield filePath;
  }
}

interface IOptionValues {
  dir: string;
  ext?: string;
  keys: string[];
  from: string;
  to: string;
}

program
  .requiredOption('-d, --dir <dirPath>', 'Target directory path')
  .option('-e, --ext <extName>', 'Target ext name')
  .requiredOption('-k, --keys <keys...>', 'Keys to find')
  .requiredOption('-f, --from <from>', 'from str')
  .requiredOption('-t, --to <to>', 'to str')
  .parse();

const options = program.opts<IOptionValues>();

const conversionFile = async (
  spinnerUpdater: () => void,
  rootDir: string,
  filePath: string,
  keyRexp: RegExp,
  from: IOptionValues['from'],
  to: IOptionValues['to'],
) => {
  const fileContent = (await fs.readFile(filePath)).toString();
  const conversioned = fileContent.replaceAll(keyRexp, (subStr) => {
    return subStr.replaceAll(from, to);
  });

  const fileRelativePath = path.relative(rootDir, filePath);
  await writeBuffer('./' + fileRelativePath, conversioned);
  spinnerUpdater();
  return true;
};

// Actual main

const startConversioin = async (options: IOptionValues) => {
  const { dir, ext, keys, from, to } = options;
  const originFilePaths: string[] = [];
  const sortedKeys = keys.sort((a, b) => b.length - a.length);
  const keyRexp = new RegExp(`(${sortedKeys.join('|')})`, 'g');
  const status = { doneCount: 0 };

  const spinnerUpdater = () => {
    status.doneCount++;
    spinner.text = `${status.doneCount} / ${originFilePaths.length}`;
  };

  for await (const filePath of getSpecificFiles(
    (filePath) => !ext || filePath.endsWith(`.${ext}`),
    dir,
  )) {
    originFilePaths.push(filePath);
  }

  spinner.info(`${originFilePaths.length} files found.`);
  spinner.start();

  return await Promise.allSettled(
    originFilePaths.map((filePath) =>
      conversionFile(spinnerUpdater, dir, filePath, keyRexp, from, to),
    ),
  );
};

const checkConversionResult = (result: PromiseSettledResult<boolean>[]) => {
  result.forEach((promiseResult) => {
    if (promiseResult.status === 'rejected') {
      throw new Error(promiseResult.reason);
    }
  });

  return true;
};

// main

(async () => {
  try {
    await initBuffer();
    spinner.succeed(chalkSuccess(`Buffer created at ${BUFFER_PATH}`));

    const result = await startConversioin(options);

    if (checkConversionResult(result)) {
      await replaceOriginWithBuffer(path.resolve(options.dir));
      spinner.succeed(`All conversions succeed.`);
    }
  } catch (e) {
    spinner.fail(chalkError((e as Error).message));
    console.error(e);
  }

  await clearBuffer();
  spinner.succeed(chalkSuccess(`Buffer cleared`));
})();
