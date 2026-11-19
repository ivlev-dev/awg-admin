package space.ivlev.umbravpn.data

import java.io.File
import java.sql.Connection
import java.sql.DriverManager
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class DatabaseSchemaIndexTest {

    private lateinit var connection: Connection

    @Before
    fun setUp() {
        connection = DriverManager.getConnection("jdbc:sqlite::memory:")
        schemaStatements().forEach { statement ->
            connection.createStatement().use { it.execute(statement) }
        }
    }

    @After
    fun tearDown() {
        connection.close()
    }

    @Test
    fun schemaDeclaresHotOrderByIndices() {
        val statements = schemaStatements()

        assertTrue(
            statements.any { it.contains("index_managed_tunnel_device_name_interface_id_peer_id") },
        )
        assertTrue(statements.any { it.contains("index_tunnel_config_position") })
    }

    @Test
    fun managedTunnelOrderByUsesIndexWithoutTemporaryBTree() {
        val plan =
            queryPlan("SELECT * FROM managed_tunnel ORDER BY device_name, interface_id, peer_id")

        assertTrue(plan, plan.contains("USING INDEX"))
        assertFalse(plan, plan.contains("TEMP B-TREE"))
    }

    @Test
    fun managedTunnelDeviceOrderByUsesPrimaryKeyIndex() {
        val plan =
            queryPlan(
                "SELECT * FROM managed_tunnel WHERE device_id = 'device-1' " +
                    "ORDER BY interface_id, peer_id",
            )

        assertFalse(plan, plan.contains("TEMP B-TREE"))
    }

    @Test
    fun tunnelConfigOrderByPositionUsesIndexWithoutTemporaryBTree() {
        val plan = queryPlan("SELECT * FROM tunnel_config ORDER BY position")

        assertTrue(plan, plan.contains("USING INDEX index_tunnel_config_position"))
        assertFalse(plan, plan.contains("TEMP B-TREE"))
    }

    private fun queryPlan(sql: String): String =
        connection.createStatement().use { statement ->
            statement.executeQuery("EXPLAIN QUERY PLAN $sql").use { cursor ->
                buildString {
                    while (cursor.next()) {
                        append(cursor.getString("detail")).append('\n')
                    }
                }
            }
        }

    private fun schemaStatements(): List<String> {
        val root = Json.parseToJsonElement(schemaFile().readText()).jsonObject
        val entities = root.getValue("database").jsonObject.getValue("entities").jsonArray
        return entities.flatMap { element ->
            val entity = element.jsonObject
            val tableName = entity.getValue("tableName").jsonPrimitive.content
            buildList {
                add(
                    entity
                        .getValue("createSql")
                        .jsonPrimitive
                        .content
                        .replace(TABLE_NAME, tableName),
                )
                entity["indices"]?.jsonArray?.forEach { index ->
                    add(
                        index.jsonObject
                            .getValue("createSql")
                            .jsonPrimitive
                            .content
                            .replace(TABLE_NAME, tableName),
                    )
                }
            }
        }
    }

    private fun schemaFile(): File {
        val relative = "schemas/space.ivlev.umbravpn.data.AppDatabase/$SCHEMA_VERSION.json"
        val candidates = listOf(File(relative), File("app/$relative"))
        return candidates.firstOrNull { it.exists() }
            ?: error("Schema file not found from ${File(".").absolutePath}")
    }

    private companion object {
        const val TABLE_NAME = "\${TABLE_NAME}"
        const val SCHEMA_VERSION = 46
    }
}
