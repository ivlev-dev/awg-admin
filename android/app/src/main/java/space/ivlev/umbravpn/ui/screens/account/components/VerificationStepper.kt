package space.ivlev.umbravpn.ui.screens.account.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.HourglassEmpty
import androidx.compose.material.icons.outlined.MarkEmailRead
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.ui.theme.SilverTree

@Composable
fun VerificationStepper(
    currentStep: Int,
    completed: Boolean = false,
    modifier: Modifier = Modifier,
) {
    val steps =
        listOf(
            StepperStep(R.string.account_verify_step_email, Icons.Outlined.MarkEmailRead),
            StepperStep(R.string.account_verify_step_review, Icons.Outlined.HourglassEmpty),
            StepperStep(R.string.account_verify_step_access, Icons.Outlined.VerifiedUser),
        )

    Column(modifier = modifier.fillMaxWidth()) {
        steps.forEachIndexed { index, step ->
            val state =
                when {
                    completed -> StepState.Done
                    index < currentStep -> StepState.Done
                    index == currentStep -> StepState.Current
                    else -> StepState.Pending
                }
            StepRow(step = step, state = state)
            if (index < steps.lastIndex) {
                Box(
                    modifier =
                        Modifier.padding(start = 17.dp)
                            .size(width = 2.dp, height = 18.dp)
                            .background(
                                if (state == StepState.Done) SilverTree.copy(alpha = 0.5f)
                                else MaterialTheme.colorScheme.outline.copy(alpha = 0.25f),
                            ),
                )
            }
        }
    }
}

@Composable
private fun StepRow(step: StepperStep, state: StepState) {
    val accent =
        when (state) {
            StepState.Done -> SilverTree
            StepState.Current -> MaterialTheme.colorScheme.primary
            StepState.Pending -> MaterialTheme.colorScheme.outline
        }
    val container =
        when (state) {
            StepState.Done -> SilverTree.copy(alpha = 0.16f)
            StepState.Current -> MaterialTheme.colorScheme.primary.copy(alpha = 0.14f)
            StepState.Pending -> Color.Transparent
        }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Surface(
            shape = CircleShape,
            color = container,
            contentColor = accent,
            border = androidx.compose.foundation.BorderStroke(1.dp, accent.copy(alpha = 0.4f)),
            modifier = Modifier.size(36.dp),
        ) {
            Icon(
                imageVector = if (state == StepState.Done) Icons.Outlined.Check else step.icon,
                contentDescription = null,
                tint = accent,
                modifier = Modifier.padding(9.dp),
            )
        }
        Text(
            text = stringResource(step.titleRes),
            style =
                if (state == StepState.Current) MaterialTheme.typography.titleSmall
                else MaterialTheme.typography.bodyMedium,
            color =
                when (state) {
                    StepState.Done -> MaterialTheme.colorScheme.onSurface
                    StepState.Current -> MaterialTheme.colorScheme.primary
                    StepState.Pending -> MaterialTheme.colorScheme.outline
                },
        )
    }
}

private data class StepperStep(val titleRes: Int, val icon: ImageVector)

private enum class StepState {
    Done,
    Current,
    Pending,
}
