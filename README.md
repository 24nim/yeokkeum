# 엮음 기록장

메모 한 줄을 쓰면 현장일지·가계부 같은 책에 자동으로 엮어 주는 개인 기록 앱이에요.

- 주소: https://24nim.github.io/yeokkeum/
- 휴대폰·태블릿·노트북에서 설치해서 쓰는 웹앱(PWA)이에요.
- 기록은 주인 구글 계정의 Firebase(무료 요금제, 프로젝트 kimnote-23efc)에 저장되고, Firestore 규칙으로 주인 계정만 읽고 쓸 수 있어요.
- 이 저장소에는 앱 코드만 있고 기록은 없어요.

## 고치는 방법 (개발용)

- 원본 코드는 `source/src`에 있어요. 루트의 `index.html`, `app.js`, `sw.js`는 빌드 결과물이라 직접 고치지 않아요.
- 고친 뒤 `sh source/build.sh`를 실행하면 루트에 새 결과물이 만들어지고, 푸시하면 깃허브 페이지에 1~2분 안에 반영돼요.
- `source/src/logic.js`는 브라우저 없이 `node`로 시험할 수 있어요 (`source/test/learn.test.js` 참고).
- `source/test/mock-firebase.js`는 Firebase 대신 쓰는 시험용 가짜예요 (Playwright 시험 `flow.py`에서 사용).
