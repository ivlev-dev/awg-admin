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
  конкретного интерфейса.
- Привязка «устройство + интерфейс» хранится в Room (`managed_tunnel`), поэтому
  у одного устройства может быть несколько туннелей.
- Удаление туннеля, если устройство удалено или отозвано на сервере.
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
