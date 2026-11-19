# Бренд Umbra VPN

## Логотип

Основа: щит (безопасность) + тоннельные кольца (VPN) + тень-полумесяц (umbra).
Светлый фон, палитра Material You.

- Основной знак: `frontend/public/brand.svg`
- Android adaptive foreground: `android/app/src/main/res/drawable/ic_launcher_foreground.xml`
- Monochrome (themed icons): `android/app/src/main/res/drawable/ic_launcher_monochrome.xml`
- Splash: `android/app/src/main/res/drawable/ic_splash_logo.xml`

## Палитра

| Роль | Light | Использование |
|---|---|---|
| Primary | `#0E4688` | щит, акценты |
| On primary | `#FFFFFF` | монограмма U |
| Primary container | `#CDDDFF` | кольца, тень щита |
| On primary container | `#001738` | тень U |
| Surface | `#FBF9FB` | фон иконки |
| Surface variant | `#E9EEF6` | градиент фона |

Градиент щита: `#1B4372 → #0E4688` (только заливка щита; для themed icons
используется монохромный drawable).

## Правила

- Не добавлять текст в иконку; название только рядом с логотипом.
- Не менять пропорции щита и толщину U независимо друг от друга.
- Safe zone adaptive icon: знак занимает ≤66% площади; фон — отдельный слой.
- На тёмных поверхностях использовать светлый щит `#FBF9FB` с синей U
  (splash/banner), на светлых — синий щит с белой U.
- Минимальный размер: 24 px (в UI), 48 px (иконка приложения).
- Не наклонять, не добавлять обводки/тени вне штатной тени щита.
