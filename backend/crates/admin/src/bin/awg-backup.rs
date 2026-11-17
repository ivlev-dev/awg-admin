use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::atomic::{AtomicU64, Ordering};

use awg_storage::{CURRENT_SCHEMA_VERSION, SCHEMA_VERSION_KEY, StorageError, Store, Table};
use redb::{Database, ReadableDatabase, ReadableTableMetadata, TableHandle};

const EXIT_FAILURE: u8 = 1;
const EXIT_USAGE: u8 = 2;

const HELP: &str = "\
awg-backup — резервное копирование и восстановление БД redb awg-admin

Использование:
  awg-backup backup  --db <PATH> --out <PATH> [--force]
  awg-backup restore --db <PATH> --from <PATH> [--offline]
  awg-backup info    --db <PATH>
  awg-backup --help

Команды:
  backup   атомарно скопировать БД в новый файл и проверить целостность
  restore  восстановить БД из backup (по умолчанию — одной транзакцией)
  info     показать версию схемы, размер и список таблиц

Опции:
  --db <PATH>    путь к БД; если не задан, берётся AWG_DB_PATH
  --out <PATH>   путь нового backup
  --from <PATH>  файл backup для восстановления
  --force        перезаписать существующий backup
  --offline      заменить файл БД целиком (временный файл + атомарный rename)
  -h, --help     показать эту справку

Перед backup и restore остановите awg-admin: redb открывает файл БД
эксклюзивно, запущенный admin блокирует и backup, и restore.

Коды выхода: 0 — успех, 1 — ошибка операции, 2 — ошибка аргументов.";

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

fn main() -> ExitCode {
    match run(std::env::args_os().skip(1).collect()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(failure) => {
            eprintln!("awg-backup: {}", failure.message);
            if failure.code == EXIT_USAGE {
                eprintln!("Подсказка: awg-backup --help");
            }
            ExitCode::from(failure.code)
        }
    }
}

#[derive(Debug)]
struct CliFailure {
    code: u8,
    message: String,
}

impl CliFailure {
    fn usage(message: impl Into<String>) -> Self {
        Self {
            code: EXIT_USAGE,
            message: message.into(),
        }
    }

    fn runtime(message: impl Into<String>) -> Self {
        Self {
            code: EXIT_FAILURE,
            message: message.into(),
        }
    }
}

type CliResult<T> = Result<T, CliFailure>;

enum Command {
    Backup {
        db: PathBuf,
        out: PathBuf,
        force: bool,
    },
    Restore {
        db: PathBuf,
        from: PathBuf,
        offline: bool,
    },
    Info {
        db: PathBuf,
    },
}

enum Parsed {
    Help,
    Run(Command),
}

fn run(raw: Vec<OsString>) -> CliResult<()> {
    match parse(raw)? {
        Parsed::Help => {
            println!("{HELP}");
            Ok(())
        }
        Parsed::Run(Command::Backup { db, out, force }) => backup(&db, &out, force),
        Parsed::Run(Command::Restore { db, from, offline }) => restore(&db, &from, offline),
        Parsed::Run(Command::Info { db }) => info(&db),
    }
}

fn parse(raw: Vec<OsString>) -> CliResult<Parsed> {
    let mut iter = raw.into_iter();
    let Some(first) = iter.next() else {
        return Err(CliFailure::usage("не указана команда"));
    };
    let Some(name) = first.to_str() else {
        return Err(CliFailure::usage("команда должна быть UTF-8"));
    };
    if matches!(name, "help" | "--help" | "-h") {
        return Ok(Parsed::Help);
    }

    let mut db = None;
    let mut out = None;
    let mut from = None;
    let mut force = false;
    let mut offline = false;

    while let Some(arg) = iter.next() {
        let Some(arg) = arg.to_str() else {
            return Err(CliFailure::usage("аргументы должны быть UTF-8"));
        };
        match arg {
            "--help" | "-h" => return Ok(Parsed::Help),
            "--force" => force = true,
            "--offline" => offline = true,
            "--db" => db = Some(take_path(&mut iter, "--db")?),
            "--out" => out = Some(take_path(&mut iter, "--out")?),
            "--from" => from = Some(take_path(&mut iter, "--from")?),
            _ => {
                if let Some(value) = arg.strip_prefix("--db=") {
                    db = Some(path_value(value, "--db")?);
                } else if let Some(value) = arg.strip_prefix("--out=") {
                    out = Some(path_value(value, "--out")?);
                } else if let Some(value) = arg.strip_prefix("--from=") {
                    from = Some(path_value(value, "--from")?);
                } else {
                    return Err(CliFailure::usage(format!("неизвестный аргумент: {arg}")));
                }
            }
        }
    }

    let command = match name {
        "backup" => {
            if offline {
                return Err(CliFailure::usage("--offline применим только к restore"));
            }
            let db = require_db(db)?;
            let out = out.ok_or_else(|| CliFailure::usage("backup требует --out"))?;
            Command::Backup { db, out, force }
        }
        "restore" => {
            if force {
                return Err(CliFailure::usage("--force применим только к backup"));
            }
            let db = require_db(db)?;
            let from = from.ok_or_else(|| CliFailure::usage("restore требует --from"))?;
            Command::Restore { db, from, offline }
        }
        "info" => {
            if force || offline {
                return Err(CliFailure::usage("info не принимает --force и --offline"));
            }
            if out.is_some() || from.is_some() {
                return Err(CliFailure::usage("info не принимает --out и --from"));
            }
            Command::Info {
                db: require_db(db)?,
            }
        }
        other => return Err(CliFailure::usage(format!("неизвестная команда: {other}"))),
    };

    Ok(Parsed::Run(command))
}

fn take_path(iter: &mut impl Iterator<Item = OsString>, flag: &str) -> CliResult<PathBuf> {
    let value = iter
        .next()
        .ok_or_else(|| CliFailure::usage(format!("{flag} требует значение")))?;
    let Some(value) = value.to_str() else {
        return Err(CliFailure::usage(format!("{flag}: путь должен быть UTF-8")));
    };
    path_value(value, flag)
}

fn path_value(value: &str, flag: &str) -> CliResult<PathBuf> {
    if value.is_empty() {
        return Err(CliFailure::usage(format!("{flag} требует непустой путь")));
    }
    Ok(PathBuf::from(value))
}

fn require_db(db: Option<PathBuf>) -> CliResult<PathBuf> {
    db.or_else(|| {
        std::env::var_os("AWG_DB_PATH")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
    })
    .ok_or_else(|| CliFailure::usage("не задан путь к БД: укажите --db или AWG_DB_PATH"))
}

fn backup(db: &Path, out: &Path, force: bool) -> CliResult<()> {
    require_file(db, "база данных")?;
    if same_target(db, out) {
        return Err(CliFailure::runtime(
            "путь backup совпадает с путём БД: выберите другой --out",
        ));
    }
    if out.is_dir() {
        return Err(CliFailure::runtime(format!(
            "--out указывает на каталог: {}",
            out.display()
        )));
    }
    if out.exists() && !force {
        return Err(CliFailure::runtime(format!(
            "backup уже существует: {}; используйте --force для перезаписи",
            out.display()
        )));
    }
    create_parent(out)?;

    let database = open_exclusive(db)?;
    let version = read_version(&database)?;

    let temp = temp_path(out);
    let _ = fs::remove_file(&temp);
    let result = copy_file(db, &temp)
        .and_then(|()| verify_database(&temp))
        .and_then(|()| sync_file(&temp))
        .and_then(|()| replace_file(&temp, out));
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result?;
    drop(database);

    let size = fs::metadata(out).map(|meta| meta.len()).unwrap_or(0);
    println!(
        "backup создан: {} ({} байт, схема {})",
        out.display(),
        size,
        describe_version(version)
    );
    Ok(())
}

fn restore(db: &Path, from: &Path, offline: bool) -> CliResult<()> {
    require_file(from, "backup")?;
    if same_target(db, from) {
        return Err(CliFailure::runtime(
            "путь backup совпадает с путём БД: восстановление из самого себя запрещено",
        ));
    }

    let version = check_backup(from)?;

    if offline {
        restore_file(db, from)?;
        println!(
            "база восстановлена: {} (схема {}, режим: замена файла)",
            db.display(),
            version
        );
        return Ok(());
    }

    create_parent(db)?;
    let store = Store::open(db).map_err(|err| map_store_open(db, err))?;
    store.restore_from(from).map_err(|err| {
        CliFailure::runtime(format!("не удалось восстановить {}: {err}", db.display()))
    })?;
    let restored = store
        .schema_version()
        .map_err(|err| CliFailure::runtime(format!("не удалось прочитать версию схемы: {err}")))?;
    println!(
        "база восстановлена: {} (схема {}, режим: транзакция)",
        db.display(),
        restored
    );
    Ok(())
}

fn restore_file(db: &Path, from: &Path) -> CliResult<()> {
    create_parent(db)?;
    let lock = if db.is_file() {
        open_for_replace(db)?
    } else {
        None
    };

    let result = Store::replace_file_from(from, db).map_err(|err| {
        CliFailure::runtime(format!(
            "не удалось заменить {} из {}: {err}",
            db.display(),
            from.display()
        ))
    });
    drop(lock);
    result
}

fn open_for_replace(path: &Path) -> CliResult<Option<Database>> {
    match Database::builder()
        .set_check_integrity_on_open(true)
        .open(path)
    {
        Ok(database) => Ok(Some(database)),
        Err(redb::DatabaseError::DatabaseAlreadyOpen) => Err(map_open_error(
            path,
            redb::DatabaseError::DatabaseAlreadyOpen,
        )),
        Err(_) => Ok(None),
    }
}

fn info(db: &Path) -> CliResult<()> {
    require_file(db, "база данных")?;
    let size = fs::metadata(db)
        .map_err(|err| {
            CliFailure::runtime(format!("не удалось прочитать {}: {err}", db.display()))
        })?
        .len();

    let database = open_read_only(db)?;
    let txn = database.begin_read().map_err(|err| {
        CliFailure::runtime(format!("не удалось прочитать {}: {err}", db.display()))
    })?;
    let version = version_from_txn(&txn)?;

    let mut tables = Vec::new();
    for handle in txn
        .list_tables()
        .map_err(|err| CliFailure::runtime(format!("не удалось получить таблицы: {err}")))?
    {
        let name = handle.name().to_string();
        let table = txn.open_untyped_table(handle).map_err(|err| {
            CliFailure::runtime(format!("не удалось открыть таблицу {name}: {err}"))
        })?;
        let len = table.len().map_err(|err| {
            CliFailure::runtime(format!("не удалось прочитать таблицу {name}: {err}"))
        })?;
        tables.push((name, len));
    }
    tables.sort_by(|left, right| left.0.cmp(&right.0));

    println!("База: {}", db.display());
    println!("Размер: {size} байт");
    println!(
        "Версия схемы: {} (поддерживается {CURRENT_SCHEMA_VERSION})",
        describe_version(version)
    );
    if version != Some(CURRENT_SCHEMA_VERSION) {
        println!("Совместимость: нет, restore будет отклонён");
    } else {
        println!("Совместимость: да");
    }
    println!("Таблицы ({}):", tables.len());
    for (name, len) in tables {
        println!("  {name}  {len}");
    }
    Ok(())
}

fn check_backup(path: &Path) -> CliResult<u32> {
    let database = open_read_only(path).map_err(|err| {
        CliFailure::runtime(format!(
            "не удалось открыть backup {}: {}",
            path.display(),
            err.message
        ))
    })?;
    let version = read_version(&database)?;
    match version {
        None => Err(CliFailure::runtime(format!(
            "в backup {} нет ключа meta.{SCHEMA_VERSION_KEY}",
            path.display()
        ))),
        Some(found) if found == CURRENT_SCHEMA_VERSION => Ok(found),
        Some(found) => Err(CliFailure::runtime(format!(
            "несовместимая версия схемы: backup {found}, поддерживается {CURRENT_SCHEMA_VERSION}; \
             используйте awg-backup от версии admin, создавшей backup"
        ))),
    }
}

fn read_version(database: &impl ReadableDatabase) -> CliResult<Option<u32>> {
    let txn = database
        .begin_read()
        .map_err(|err| CliFailure::runtime(format!("не удалось прочитать схему: {err}")))?;
    version_from_txn(&txn)
}

fn version_from_txn(txn: &redb::ReadTransaction) -> CliResult<Option<u32>> {
    let table = match txn.open_table(Table::Meta.definition()) {
        Ok(table) => table,
        Err(redb::TableError::TableDoesNotExist(_)) => return Ok(None),
        Err(err) => {
            return Err(CliFailure::runtime(format!(
                "не удалось открыть meta: {err}"
            )));
        }
    };
    let Some(raw) = table
        .get(SCHEMA_VERSION_KEY)
        .map_err(|err| CliFailure::runtime(format!("не удалось прочитать meta: {err}")))?
    else {
        return Ok(None);
    };
    serde_json::from_slice(raw.value())
        .map(Some)
        .map_err(|err| CliFailure::runtime(format!("некорректная {SCHEMA_VERSION_KEY}: {err}")))
}

fn open_exclusive(path: &Path) -> CliResult<Database> {
    Database::builder()
        .set_check_integrity_on_open(true)
        .open(path)
        .map_err(|err| map_open_error(path, err))
}

fn open_read_only(path: &Path) -> CliResult<redb::ReadOnlyDatabase> {
    Database::builder()
        .set_check_integrity_on_open(true)
        .open_read_only(path)
        .map_err(|err| map_open_error(path, err))
}

fn map_open_error(path: &Path, err: redb::DatabaseError) -> CliFailure {
    match err {
        redb::DatabaseError::DatabaseAlreadyOpen => CliFailure::runtime(format!(
            "файл {} занят другим процессом (запущен awg-admin?); остановите admin и повторите",
            path.display()
        )),
        redb::DatabaseError::RepairAborted => CliFailure::runtime(format!(
            "файл {} требует восстановления после некорректной остановки; запустите и корректно остановите awg-admin, затем повторите",
            path.display()
        )),
        other => CliFailure::runtime(format!("не удалось открыть {}: {other}", path.display())),
    }
}

fn map_store_open(path: &Path, err: StorageError) -> CliFailure {
    match &err {
        StorageError::Db(redb::DatabaseError::DatabaseAlreadyOpen) => CliFailure::runtime(format!(
            "файл {} занят другим процессом (запущен awg-admin?); остановите admin и повторите",
            path.display()
        )),
        StorageError::SchemaTooNew { .. } => CliFailure::runtime(format!(
            "не удалось открыть {}: {err}; для замены файла без открытия текущей БД используйте --offline",
            path.display()
        )),
        _ => CliFailure::runtime(format!("не удалось открыть {}: {err}", path.display())),
    }
}

fn verify_database(path: &Path) -> CliResult<()> {
    Database::builder()
        .set_check_integrity_on_open(true)
        .open(path)
        .map(drop)
        .map_err(|err| {
            CliFailure::runtime(format!(
                "backup не прошёл проверку целостности {}: {err}",
                path.display()
            ))
        })
}

fn copy_file(from: &Path, to: &Path) -> CliResult<()> {
    fs::copy(from, to).map(|_| ()).map_err(|err| {
        CliFailure::runtime(format!("не удалось скопировать {}: {err}", from.display()))
    })
}

fn sync_file(path: &Path) -> CliResult<()> {
    fs::File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(|err| {
            CliFailure::runtime(format!(
                "не удалось синхронизировать {}: {err}",
                path.display()
            ))
        })
}

fn replace_file(temp: &Path, target: &Path) -> CliResult<()> {
    #[cfg(unix)]
    fs::rename(temp, target).map_err(|err| {
        CliFailure::runtime(format!("не удалось заменить {}: {err}", target.display()))
    })?;
    #[cfg(not(unix))]
    {
        if target.exists() {
            fs::remove_file(target).map_err(|err| {
                CliFailure::runtime(format!("не удалось удалить {}: {err}", target.display()))
            })?;
        }
        fs::rename(temp, target).map_err(|err| {
            CliFailure::runtime(format!("не удалось заменить {}: {err}", target.display()))
        })?;
    }
    sync_parent(target);
    Ok(())
}

fn require_file(path: &Path, what: &str) -> CliResult<()> {
    if !path.is_file() {
        return Err(CliFailure::runtime(format!(
            "{what} не найден: {}",
            path.display()
        )));
    }
    Ok(())
}

fn same_target(db: &Path, other: &Path) -> bool {
    if db == other {
        return true;
    }
    match (fs::canonicalize(db), canonical_target(other)) {
        (Ok(db), Some(other)) => db == other,
        _ => false,
    }
}

fn canonical_target(path: &Path) -> Option<PathBuf> {
    if let Ok(path) = fs::canonicalize(path) {
        return Some(path);
    }
    let name = path.file_name()?;
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    fs::canonicalize(parent)
        .ok()
        .map(|parent| parent.join(name))
}

fn create_parent(path: &Path) -> CliResult<()> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).map_err(|err| {
            CliFailure::runtime(format!(
                "не удалось создать каталог {}: {err}",
                parent.display()
            ))
        })?;
    }
    Ok(())
}

fn sync_parent(path: &Path) {
    #[cfg(unix)]
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        let _ = fs::File::open(parent).and_then(|dir| dir.sync_all());
    }
}

fn temp_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(format!(
        ".tmp-{}-{}",
        std::process::id(),
        TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    PathBuf::from(name)
}

fn describe_version(version: Option<u32>) -> String {
    match version {
        Some(version) => version.to_string(),
        None => "неизвестна".to_string(),
    }
}
