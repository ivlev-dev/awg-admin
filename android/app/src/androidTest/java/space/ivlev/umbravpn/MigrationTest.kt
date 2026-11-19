package space.ivlev.umbravpn

import androidx.room.testing.MigrationTestHelper
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import space.ivlev.umbravpn.data.AppDatabase
import space.ivlev.umbravpn.data.migrations.MIGRATION_42_43
import space.ivlev.umbravpn.data.migrations.MIGRATION_43_44
import space.ivlev.umbravpn.data.migrations.MIGRATION_44_45

@RunWith(AndroidJUnit4::class)
class MigrationTest {
    private val dbName = "migration-test"

    @get:Rule
    val helper: MigrationTestHelper =
        MigrationTestHelper(InstrumentationRegistry.getInstrumentation(), AppDatabase::class.java)

    @Test
    @Throws(IOException::class)
    fun migrate6To7() {
        helper.createDatabase(dbName, 6).apply {
            // Database has schema version 1. Insert some data using SQL queries.
            // You can't use DAO classes because they expect the latest schema.
            // Prepare for the next version.
            close()
        }

        // Re-open the database with version 2 and provide
        // MIGRATION_1_2 as the migration process.
        helper.runMigrationsAndValidate(dbName, 7, true)
        // MigrationTestHelper automatically verifies the schema changes,
        // but you need to validate that the data was migrated properly.
    }

    @Test
    @Throws(IOException::class)
    fun migrate42To43CreatesManagedTunnelTable() {
        helper.createDatabase(dbName, 42).apply { close() }

        helper.runMigrationsAndValidate(dbName, 43, true, MIGRATION_42_43)
    }

    @Test
    @Throws(IOException::class)
    fun migrate43To44UsesCompositeDeviceInterfaceKey() {
        helper.createDatabase(dbName, 43).apply {
            execSQL(
                """
                INSERT INTO `managed_tunnel`
                    (`device_id`, `tunnel_id`, `device_name`, `interface_id`, `endpoint`,
                     `revision`, `synced_at`)
                VALUES
                    ('device-1', 7, 'Pixel', NULL, 'vpn.example.com:51820', 'rev-1', 1)
                """
                    .trimIndent(),
            )
            execSQL(
                """
                INSERT INTO `managed_tunnel`
                    (`device_id`, `tunnel_id`, `device_name`, `interface_id`, `endpoint`,
                     `revision`, `synced_at`)
                VALUES
                    ('device-2', 8, 'Laptop', 'iface-2', NULL, 'rev-2', 2)
                """
                    .trimIndent(),
            )
            close()
        }

        val db = helper.runMigrationsAndValidate(dbName, 44, true, MIGRATION_43_44)
        db.query(
                "SELECT `device_id`, `interface_id`, `tunnel_id` FROM `managed_tunnel` " +
                    "ORDER BY `device_id`",
            )
            .use { cursor ->
                assertEquals(2, cursor.count)
                cursor.moveToFirst()
                assertEquals("device-1", cursor.getString(0))
                assertEquals("", cursor.getString(1))
                assertEquals(7, cursor.getInt(2))
                cursor.moveToNext()
                assertEquals("device-2", cursor.getString(0))
                assertEquals("iface-2", cursor.getString(1))
                assertEquals(8, cursor.getInt(2))
            }

        db.execSQL(
            """
            INSERT INTO `managed_tunnel`
                (`device_id`, `tunnel_id`, `device_name`, `interface_id`, `endpoint`,
                 `revision`, `synced_at`)
            VALUES ('device-1', 9, 'Pixel', 'iface-3', NULL, 'rev-3', 3)
            """
                .trimIndent(),
        )
        db.query("SELECT COUNT(*) FROM `managed_tunnel` WHERE `device_id` = 'device-1'").use {
            cursor ->
            cursor.moveToFirst()
            assertEquals(2, cursor.getInt(0))
        }
    }

    @Test
    @Throws(IOException::class)
    fun migrate44To45AddsPeerKeyAndLabel() {
        helper.createDatabase(dbName, 44).apply {
            execSQL(
                """
                INSERT INTO `managed_tunnel`
                    (`device_id`, `tunnel_id`, `device_name`, `interface_id`, `endpoint`,
                     `revision`, `synced_at`)
                VALUES
                    ('device-1', 7, 'Pixel', 'iface-1', 'vpn.example.com:51820', 'rev-1', 1)
                """
                    .trimIndent(),
            )
            close()
        }

        val db = helper.runMigrationsAndValidate(dbName, 45, true, MIGRATION_44_45)
        db.query(
                "SELECT `device_id`, `interface_id`, `peer_id`, `label`, `tunnel_id` " +
                    "FROM `managed_tunnel`",
            )
            .use { cursor ->
                assertEquals(1, cursor.count)
                cursor.moveToFirst()
                assertEquals("device-1", cursor.getString(0))
                assertEquals("iface-1", cursor.getString(1))
                assertEquals("", cursor.getString(2))
                assertEquals("", cursor.getString(3))
                assertEquals(7, cursor.getInt(4))
            }

        db.execSQL(
            """
            INSERT INTO `managed_tunnel`
                (`device_id`, `tunnel_id`, `device_name`, `interface_id`, `endpoint`,
                 `revision`, `synced_at`, `peer_id`, `label`)
            VALUES
                ('device-1', 8, 'Pixel', 'iface-1', NULL, 'rev-2', 2, 'peer-2', 'extra')
            """
                .trimIndent(),
        )
        db.query("SELECT COUNT(*) FROM `managed_tunnel` WHERE `device_id` = 'device-1'").use {
            cursor ->
            cursor.moveToFirst()
            assertEquals(2, cursor.getInt(0))
        }
    }

    @Test
    @Throws(IOException::class)
    fun migrate45To46AddsHotOrderByIndices() {
        helper.createDatabase(dbName, 45).apply {
            execSQL(
                """
                INSERT INTO `managed_tunnel`
                    (`device_id`, `tunnel_id`, `device_name`, `interface_id`, `endpoint`,
                     `revision`, `synced_at`, `peer_id`, `label`)
                VALUES ('device-1', 7, 'Pixel', 'iface-1', NULL, 'rev-1', 1, '', '')
                """
                    .trimIndent(),
            )
            execSQL(
                """
                INSERT INTO `tunnel_config`
                    (`name`, `quick_config`, `position`)
                VALUES ('Pixel', '', 0)
                """
                    .trimIndent(),
            )
            close()
        }

        val db = helper.runMigrationsAndValidate(dbName, 46, true)

        val managedTunnelIndices = db.indexNames("managed_tunnel")
        assertTrue(
            managedTunnelIndices.contains(
                "index_managed_tunnel_device_name_interface_id_peer_id",
            ),
        )
        assertTrue(db.indexNames("tunnel_config").contains("index_tunnel_config_position"))

        db.query(
                "SELECT COUNT(*) FROM `managed_tunnel` WHERE `device_id` = 'device-1' " +
                    "AND `peer_id` = ''",
            )
            .use { cursor ->
                cursor.moveToFirst()
                assertEquals(1, cursor.getInt(0))
            }
    }

    @Test
    @Throws(IOException::class)
    fun migrate42To46KeepsTunnelConfigAndManagedTunnelShape() {
        helper.createDatabase(dbName, 42).apply {
            execSQL(
                """
                INSERT INTO `tunnel_config` (`name`, `quick_config`, `position`)
                VALUES ('Pixel', '{"quick":true}', 3)
                """
                    .trimIndent(),
            )
            close()
        }

        val db =
            helper.runMigrationsAndValidate(
                dbName,
                46,
                true,
                MIGRATION_42_43,
                MIGRATION_43_44,
                MIGRATION_44_45,
            )

        db.query("SELECT `name`, `quick_config`, `position` FROM `tunnel_config`").use { cursor ->
            assertEquals(1, cursor.count)
            cursor.moveToFirst()
            assertEquals("Pixel", cursor.getString(0))
            assertEquals("{\"quick\":true}", cursor.getString(1))
            assertEquals(3, cursor.getInt(2))
        }

        db.execSQL(
            """
            INSERT INTO `managed_tunnel`
                (`device_id`, `tunnel_id`, `device_name`, `interface_id`, `endpoint`,
                 `revision`, `synced_at`, `peer_id`, `label`)
            VALUES ('device-1', 1, 'Pixel', 'iface-1', NULL, 'rev-1', 1, 'peer-1', 'home')
            """
                .trimIndent(),
        )
        db.query(
                "SELECT `device_id`, `interface_id`, `peer_id`, `label` FROM `managed_tunnel`",
            )
            .use { cursor ->
                assertEquals(1, cursor.count)
                cursor.moveToFirst()
                assertEquals("device-1", cursor.getString(0))
                assertEquals("iface-1", cursor.getString(1))
                assertEquals("peer-1", cursor.getString(2))
                assertEquals("home", cursor.getString(3))
            }
        assertTrue(
            db.indexNames("managed_tunnel")
                .contains("index_managed_tunnel_device_name_interface_id_peer_id"),
        )
    }

    private fun androidx.sqlite.db.SupportSQLiteDatabase.indexNames(table: String): Set<String> =
        query("PRAGMA index_list(`$table`)").use { cursor ->
            val nameIndex = cursor.getColumnIndex("name")
            buildSet {
                while (cursor.moveToNext()) {
                    add(cursor.getString(nameIndex))
                }
            }
        }
}
