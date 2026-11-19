package space.ivlev.umbravpn.data

import androidx.room.RoomDatabase
import androidx.sqlite.db.SupportSQLiteDatabase
import timber.log.Timber

class DatabaseCallback(private val databaseProvider: Lazy<AppDatabase>) : RoomDatabase.Callback() {
    override fun onCreate(db: SupportSQLiteDatabase) {
        super.onCreate(db)
        Timber.d("Database created, inserting default rows")
        db.execSQL("INSERT INTO proxy_settings DEFAULT VALUES")
        db.execSQL("INSERT INTO general_settings DEFAULT VALUES")
        db.execSQL("INSERT INTO auto_tunnel_settings DEFAULT VALUES")
        db.execSQL("INSERT INTO monitoring_settings DEFAULT VALUES")
        db.execSQL("INSERT INTO dns_settings DEFAULT VALUES")
    }

    override fun onOpen(db: SupportSQLiteDatabase) {
        super.onOpen(db)
        db.execSQL("PRAGMA journal_size_limit = ${DatabaseMaintenance.JOURNAL_SIZE_LIMIT_BYTES}")
        db.execSQL(
            "PRAGMA wal_autocheckpoint = ${DatabaseMaintenance.WAL_AUTOCHECKPOINT_PAGES}",
        )
        if (currentAutoVacuum(db) != AUTO_VACUUM_NONE) {
            db.execSQL("PRAGMA auto_vacuum = NONE")
            db.execSQL("VACUUM")
        }
    }

    private fun currentAutoVacuum(db: SupportSQLiteDatabase): Int =
        db.query("PRAGMA auto_vacuum").use { cursor ->
            if (cursor.moveToFirst()) cursor.getInt(0) else AUTO_VACUUM_NONE
        }

    private companion object {
        const val AUTO_VACUUM_NONE = 0
    }
}
