package space.ivlev.umbravpn.ui.state

import androidx.compose.runtime.Immutable
import com.wgtunnel.parser.ActiveConfig
import space.ivlev.umbravpn.domain.model.TunnelConfig

@Immutable
data class TunnelUiState(
    val tunnel: TunnelConfig? = null,
    val userTunnels: List<TunnelConfig> = emptyList(),
    val activeConfig: ActiveConfig? = null,
    val lastStatsAtMs: Long = 0L,
    val appliedSplit: AppliedSplitApps? = null,
    val isLoading: Boolean = true,
)
