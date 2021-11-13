# replace-rf

특저 경로내의 모든 파일내용에 대해 간단한 replace를 할 수 있도록 도와준다.

Shell script가 익숙하다면 사실 별 효용성이 없다.

## 사용법

1. **--dir** : ./src 폴더내의 
2. **--ext** : ts 확장자를 가지는 모든 파일들에 대하여 
3. **--keys** : `aatman`, `arazil`, `aonus`를 찾은 뒤
4. **--from** : `a`를 
5. **--to** : `b`로 일괄 변경하라.

```shell
npx replace-rf --dir ./src --ext ts --from a --to b --keys aatman arazil aonus
```

## 옵션들

- **--dir / -d** : 변경할 파일들이 위치한 경로
- **--ext / -e** : 변경할 파일들의 확장자. 없으면 전체 파일.
- **--keys / -k** : 변경할 문자열들. 이 문자열 범위 내에서만 변경함.
- **--from / -f** : 어떤 문자열을
- **--to / -t** : 어떤 문자열로
