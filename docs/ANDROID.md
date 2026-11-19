# Umbra VPN для Android

Клиент панели awg-admin. Основан на [wgtunnel/android](https://github.com/wgtunnel/android)
(MIT), переработан под Umbra VPN: брендинг, цвета панели, аккаунт панели и
автоматическая синхронизация конфигурации устройства.

## Что умеет

- Вход и регистрация по email через API панели (`/auth/*`), подтверждение email
  deep link `umbravpn://verify?token=…` и ожидание одобрения администратором.
- 2FA-код при входе, сброс пароля, смена адреса сервера.
- Автоматическое создание устройства при первом входе; при создании можно выбрать несколько интерфейсов — приложение подтянет по туннелю на каждый.
- Импорт конфигурации устройства в туннель AmneziaWG (I1–I5, H1–H4, S1–S4,
  Jc, PersistentKeepalive) и подключение вручную.
- Синхронизация всех конфигураций: после входа, при обновлении экрана «Аккаунт»
  и каждые 6 часов. Обновление выполняется только при смене `revision`
  конкретного пира.
- Привязка «устройство + интерфейс + пир» хранится в Room (`managed_tunnel`),
  поэтому у устройства может быть несколько туннелей, в том числе несколько
  в одном интерфейсе.
- Удаление туннеля, если пир/интерфейс/устройство удалены или устройство отозвано на сервере.
- Добавление и удаление туннелей устройства из приложения (последний пир удалить нельзя).
- Тариф, лимит устройств, расход и остаток квоты, список устройств, создание,
  переименование и удаление.
- Ручной режим без аккаунта (импорт конфигурации вручную) сохранён.

Авто-туннель (автопереключение по Wi-Fi/мобильной сети) и ручной импорт
конфигов удалены: туннели появляются только из аккаунта панели, подключение
автоматическое при входе/запуске (один активный туннель).

## Сборка

Требования: JDK 21 (Gradle сам скачает toolchain), Android SDK с
`build-tools;36.0.0`, `platforms;android-37`, NDK и Gradle 9.9 из wrapper.

```bash
cd android
echo "sdk.dir=$HOME/android-sdk" > local.properties
./gradlew :app:assembleFdroidDebug
```

APK: `android/app/build/outputs/apk/fdroid/debug/umbravpn-fdroid-v1.0.0.apk`
(universal), рядом arm64/armv7 сборки. Для эмулятора x86_64 нужен universal APK.

Скрипт из корня репозитория:

```bash
scripts/build-android.sh
```

Переменные окружения: `ANDROID_HOME`, `ANDROID_SDK_ROOT` (или `sdk.dir` в
`android/local.properties`).

## Подпись и релиз

Ключ подписи и пароли не хранятся в репозитории: `android/keystore/` и
`local.properties` исключены из git. По умолчанию release-ключ ищется в
`android/keystore/umbravpn-release.jks`.

### Локальная подпись

1. Создать ключ (нужен JDK 21 с `keytool`):

   ```bash
   cd android
   ./scripts/generate-keystore.sh
   ```

   Скрипт спросит пароли или возьмёт `SIGNING_STORE_PASSWORD`,
   `SIGNING_KEY_PASSWORD`, `SIGNING_KEY_ALIAS` и `KEY_STORE_PATH` из
   окружения, создаст PKCS12-хранилище с ключом RSA 4096 на 10000 дней и
   покажет SHA-256 отпечаток. В PKCS12 пароль хранилища и ключа должен
   совпадать; для разных паролей задайте `KEY_STORE_TYPE=JKS`. Перезапись
   существующего файла — только с `FORCE=1`. Base64 для CI:
   `PRINT_BASE64=1 ./scripts/generate-keystore.sh` (или
   `base64 -w0 keystore/umbravpn-release.jks`).

2. Указать значения в `android/local.properties` (шаблон:
   `android/app/signing_template.properties`):

   ```properties
   KEY_STORE_PATH=/home/user/awg-admin/android/keystore/umbravpn-release.jks
   SIGNING_STORE_PASSWORD=...
   SIGNING_KEY_ALIAS=umbravpn
   SIGNING_KEY_PASSWORD=...
   ```

   Те же значения можно передать переменными окружения с теми же именами;
   окружение имеет приоритет над `local.properties`.

3. Собрать и проверить:

   ```bash
   ./gradlew :app:bundleFdroidRelease :app:assembleFdroidRelease -PnoSplits=true
   apksigner verify --print-certs app/build/outputs/apk/fdroid/release/*.apk
   jarsigner -verify app/build/outputs/bundle/fdroidRelease/*.aab
   sha256sum app/build/outputs/apk/fdroid/release/*.apk
   ```

   `-PnoSplits=true` нужен, потому что AGP не позволяет одновременно собирать
   AAB и APK с ABI-сплитами в одном вызове; в релизе получается universal APK
   и AAB. Для отладочной сборки сплитов используйте
   `./gradlew :app:assembleFdroidRelease` отдельно.

   Без ключа release-задачи (`assemble*Release`, `bundle*Release`,
   `assemble*Nightly`) падают с перечнем отсутствующих параметров. Debug- и
   unit-тесты ключ не требуют.

### CI (GitHub Actions)

Release-job находится в `.github/workflows/android.yml` (job `release`) и
запускается по тегу `v*` и вручную через `workflow_dispatch` с выбором flavor.
В репозитории должны быть заданы секреты (Settings → Secrets and variables →
Actions):

| Secret | Значение |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 umbravpn-release.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | пароль хранилища |
| `ANDROID_KEY_ALIAS` | alias ключа |
| `ANDROID_KEY_PASSWORD` | пароль ключа |

Если хотя бы один секрет отсутствует, job падает до сборки и печатает список
недостающих. PR/debug-проверки (`quality`, `migration`) ключ не используют.

Job выполняет:

- JDK 21, Android SDK, кэш Gradle;
- декодирование keystore в `android/keystore/release.jks`;
- сверку тега `vX.Y.Z` с `versionName` и проверку, что `versionCode` больше
  значения из предыдущего тега; versionCode/versionName берутся из
  `android/gradle/libs.versions.toml` (задача `:app:printVersion`,
  валидация — `:app:verifyVersion`);
- сборку `:app:bundleFdroidRelease` и `:app:assembleFdroidRelease`;
- проверку подписи APK (`apksigner verify --print-certs`) и AAB
  (`jarsigner -verify`);
- артефакты: `android-release-<flavor>` (APK, AAB, `SHA256SUMS.txt`,
  `signatures/`) с retention 14 дней и `android-mapping-<flavor>`
  (`mapping.txt`, `seeds.txt`, `configuration.txt`, `resources.txt`) —
  30 дней;
- для тега — GitHub Release с APK, AAB и контрольными суммами.

Ручной запуск: Actions → Android → Run workflow → flavor. Релиз по тегу:

```bash
git tag v1.0.1
git push origin v1.0.1
```

### Хранение, ротация и ограничения

- Keystore и пароли храните в менеджере секретов, делайте резервную копию.
  Потеря ключа не позволит обновить приложение в Google Play.
- Не коммитьте `*.jks`, `*.keystore`, `local.properties` и base64-копии
  ключа: `android/keystore/.gitignore` и корневой `.gitignore` это исключают.
- При Play App Signing загружается upload key; при компрометации его можно
  заменить через Play Console. Ключ подписи приложения меняется только Play.
- F-Droid и Zapstore собирают/подписывают сами либо принимают готовый APK;
  подпись должна совпадать между релизами одного канала.
- В Google Play загружается AAB из `bundleGoogleRelease`
  (`.github/workflows/build-aab.yml`); APK из GitHub Release — для
  standalone-распространения.

## Запуск и проверка

```bash
adb install -r android/app/build/outputs/apk/fdroid/debug/umbravpn-fdroid-v1.0.0.apk
adb shell am start -n space.ivlev.umbravpn.debug/space.ivlev.umbravpn.MainActivity
```

В приложении укажите адрес панели. Для эмулятора Android это
`http://10.0.2.2:8080` (debug-сборка разрешает cleartext только для
`10.0.2.2`, `127.0.0.1` и `localhost`; release работает только по HTTPS).

Тесты:

```bash
cd android
./gradlew :app:testFdroidDebugUnitTest
```

При активном туннеле эмулятор не достаёт `10.0.2.2` (весь трафик уходит в
VPN). Для синхронизации с локальной панелью отключите туннель.

## Архитектура

- `data/account` — Ktor-клиент панели, DTO, авто-refresh токенов, `SessionManager`.
- `data/security` — `EncryptedSharedPreferences` для access/refresh токенов.
- `data/sync` — создание устройства, импорт конфигурации и сверка по `revision`;
  привязка «устройство панели ↔ туннель» хранится в Room (`managed_tunnel`).
- `core/worker` — периодическая синхронизация WorkManager (6 часов).
- `ui/screens/account` — онбординг, вход, регистрация, подтверждение, сброс
  пароля, профиль, тариф и устройства.
- `ui/theme` — палитра панели: primary `#0e4688`, фон `#f2f5f9`.

Диагностика: `adb logcat` с тегом `ManagedTunnelSyncService`/Timber.

## Ограничения

- Один тариф и одна нода на пользователя; интерфейс выбирает сервер
  (тариф → нода → группа).
- Приложение не управляет интерфейсами, нодами и тарифами — только своими
  устройствами.
- Google Play flavor сохранён для совместимости, публикация не настроена.
