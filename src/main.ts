// target list를 따로 받을 수 있음.
// change Map 생성 (함수형으로 converter를 인자로 받기?)
// traverse tree src
// change Map을 바탕으로 파일 변환

import fs from 'fs';
import path from 'path';
import { program } from 'commander';
import process from 'process';

interface IPackageInfo {
  version?: string;
  [key: string]: string | undefined;
}

const readPackageInfo = (): IPackageInfo => {
  try {
    const fileContent = fs.readFileSync(
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
