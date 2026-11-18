package space.ivlev.umbravpn.ui.common.functions

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ClipboardAutoClearTest {
    @Test
    fun clearsWhenContentIsUnchanged() {
        assertTrue(ClipboardAutoClear.shouldClear("config-knows", "config-knows"))
    }

    @Test
    fun keepsContentThatTheUserReplaced() {
        assertFalse(ClipboardAutoClear.shouldClear("config-knows", "something else"))
        assertFalse(ClipboardAutoClear.shouldClear("config-knows", null))
    }
}
