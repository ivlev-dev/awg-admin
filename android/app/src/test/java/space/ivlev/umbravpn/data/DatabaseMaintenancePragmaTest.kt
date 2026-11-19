package space.ivlev.umbravpn.data

import java.io.File
import java.sql.DriverManager
import org.junit.Assert.assertEquals
import org.junit.Test

class DatabaseMaintenancePragmaTest {

    @Test
    fun maintenancePragmasAreAcceptedBySqlite() {
        val databaseFile = File.createTempFile("umbra-wal", ".db")
        try {
            DriverManager.getConnection("jdbc:sqlite:${databaseFile.absolutePath}").use { connection
                ->
                connection.createStatement().use { statement ->
                    statement.executeQuery("PRAGMA journal_mode = WAL").close()
                    statement.execute(
                        "PRAGMA journal_size_limit = " +
                            DatabaseMaintenance.JOURNAL_SIZE_LIMIT_BYTES,
                    )
                    statement.execute(
                        "PRAGMA wal_autocheckpoint = " +
                            DatabaseMaintenance.WAL_AUTOCHECKPOINT_PAGES,
                    )
                }

                assertEquals(
                    DatabaseMaintenance.JOURNAL_SIZE_LIMIT_BYTES,
                    pragmaLong(connection, "PRAGMA journal_size_limit"),
                )
                assertEquals(
                    DatabaseMaintenance.WAL_AUTOCHECKPOINT_PAGES.toLong(),
                    pragmaLong(connection, "PRAGMA wal_autocheckpoint"),
                )

                connection.createStatement().use { statement ->
                    statement.executeQuery(DatabaseMaintenance.WAL_CHECKPOINT_TRUNCATE).use { cursor
                        ->
                        cursor.next()
                    }
                }
            }
        } finally {
            databaseFile.delete()
            File(databaseFile.absolutePath + "-wal").delete()
            File(databaseFile.absolutePath + "-shm").delete()
        }
    }

    private fun pragmaLong(connection: java.sql.Connection, sql: String): Long =
        connection.createStatement().use { statement ->
            statement.executeQuery(sql).use { cursor ->
                cursor.next()
                cursor.getLong(1)
            }
        }
}
