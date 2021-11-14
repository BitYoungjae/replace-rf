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

const BUFFER_DIR_PATH = path.resolve(process.cwd(), './.replace-rr');

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
  if (await checkFileExist(BUFFER_DIR_PATH)) {
    await clearFile(BUFFER_DIR_PATH);
  }
};

const initBuffer = async () => {
  await clearBuffer();

  try {
    await fs.mkdir(BUFFER_DIR_PATH);
  } catch {
    throw new Error(`Failed to write buffer to ${BUFFER_DIR_PATH}`);
  }
};

const writeBuffer = async (bufferFilePath: string, data: string) => {
  const bufferDirPath = path.dirname(bufferFilePath);

  if (!(await checkFileExist(bufferDirPath))) {
    await fs.mkdir(bufferDirPath, { recursive: true });
  }

  return await fs.writeFile(bufferFilePath, data, { flag: 'w' });
};

const replaceOriginWithBuffer = async (originDirPath: string) => {
  try {
    // 둘 다 성능은 비슷한 것 같은데, 후자쪽이 보조디스크 낭비가 덜할 것 같았다.
    // await fs.cp(BUFFER_PATH, originalPath, {
    //   recursive: true,
    //   force: true,
    // });

    for await (const bufferFilePath of getFilePaths(BUFFER_DIR_PATH)) {
      const relativeFilePath = path.relative(BUFFER_DIR_PATH, bufferFilePath);
      const originFilePath = path.resolve(originDirPath, relativeFilePath);

      await fs.rename(bufferFilePath, originFilePath);
    }
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

const getBufferFilePath = (originDirPath: string, originFilePath: string) => {
  const relativeFilePath = path.relative(originDirPath, originFilePath);
  return path.resolve(BUFFER_DIR_PATH, relativeFilePath);
};

const getFileContent = async (
  bufferFilePath: string,
  originFilePath: string,
) => {
  let derivedFilePath: string = originFilePath;

  if (await checkFileExist(bufferFilePath)) {
    derivedFilePath = bufferFilePath;
  }

  return (await fs.readFile(derivedFilePath)).toString();
};

const conversionFile = async (
  originDirPath: string,
  originFilePath: string,
  keyRexp: RegExp,
  from: IOptionValues['from'],
  to: IOptionValues['to'],
) => {
  const bufferFilePath = getBufferFilePath(originDirPath, originFilePath);
  const fileContent = await getFileContent(bufferFilePath, originFilePath);
  const conversioned = fileContent.replaceAll(keyRexp, (subStr) => {
    return subStr.replaceAll(from, to);
  });

  await writeBuffer(bufferFilePath, conversioned);
  return true;
};

const partitionAll = <T>(n: number, coll: T[]): T[][] => {
  if (n <= 0) {
    throw new Error('invalid agument:' + n);
  }
  const result: T[][] = [];
  let target = coll;
  while (target.length > 0) {
    result.push(target.slice(0, n));
    target = target.slice(n);
  }
  return result;
};

const getPercent = (done: number, total: number) =>
  `${Math.round((done / total) * 100)}%`;

const conversionFiles = async (
  originDirPath: string,
  keyRexp: RegExp,
  from: string,
  to: string,
  filePaths: string[],
) => {
  return await Promise.allSettled(
    filePaths.map(async (filePath) => {
      const result = await conversionFile(
        originDirPath,
        filePath,
        keyRexp,
        from,
        to,
      );

      return result;
    }),
  );
};

const genSpinnerUpdater = (total: number) => {
  const status = { done: 0, total: total };

  return (chunkSize: number) => {
    status.done += chunkSize;
    spinner.text = getPercent(status.done, status.total);
  };
};

const conversionWithSingleKey = async (
  options: IOptionValues,
  filePaths: string[],
) => {
  const result: PromiseSettledResult<boolean>[] = [];
  const { dir, keys, from, to } = options;
  const spinnerUpdater = genSpinnerUpdater(filePaths.length);

  spinnerUpdater(0);

  const keyRexp = new RegExp(keys[0], 'g');
  const fileChunks = partitionAll(CHUNK_COUNT, filePaths);

  for (const chunk of fileChunks) {
    const chunkResult = await conversionFiles(dir, keyRexp, from, to, chunk);
    result.concat(chunkResult);
    spinnerUpdater(chunk.length);
  }

  return result;
};

const CHUNK_COUNT = 50;

const conversionWithMultiKeys = async (
  options: IOptionValues,
  filePaths: string[],
) => {
  const result: PromiseSettledResult<boolean>[] = [];
  const { keys, dir, from, to } = options;
  const sortedKeys = keys.sort((a, b) => b.length - a.length);
  const keyChunks = partitionAll(CHUNK_COUNT, sortedKeys);
  const fileChunks = partitionAll(CHUNK_COUNT, filePaths);
  const spinnerUpdater = genSpinnerUpdater(keyChunks.length * filePaths.length);

  spinnerUpdater(0);

  for (const keyChunk of keyChunks) {
    const keyRexp = new RegExp(`(${keyChunk.join('|')})`, 'g');

    for (const fileChunk of fileChunks) {
      const chunkResult = await conversionFiles(
        dir,
        keyRexp,
        from,
        to,
        fileChunk,
      );
      result.concat(chunkResult);
      spinnerUpdater(fileChunk.length);
    }
  }

  return result;
};

const getOriginFilePaths = async (
  originDirPath: IOptionValues['dir'],
  ext: IOptionValues['ext'],
) => {
  const originFilePaths: string[] = [];

  for await (const filePath of getSpecificFiles(
    (filePath) => !ext || filePath.endsWith(`.${ext}`),
    originDirPath,
  )) {
    originFilePaths.push(filePath);
  }

  return originFilePaths;
};

// Actual main

const startConversioin = async (options: IOptionValues) => {
  const { dir, ext, keys } = options;
  const originFilePaths = await getOriginFilePaths(dir, ext);

  spinner.info(`${originFilePaths.length} files found.`);
  spinner.start();

  if (keys.length > 1) {
    return await conversionWithMultiKeys(options, originFilePaths);
  }

  return await conversionWithSingleKey(options, originFilePaths);
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
    spinner.succeed(chalkSuccess(`Buffer created at ${BUFFER_DIR_PATH}`));

    const result = await startConversioin(options);

    if (checkConversionResult(result)) {
      await replaceOriginWithBuffer(options.dir);
      spinner.succeed(`All conversions succeed.`);
    }
  } catch (e) {
    spinner.fail(chalkError((e as Error).message));
  }

  await clearBuffer();
  spinner.succeed(chalkSuccess(`Buffer cleared`));
})();
