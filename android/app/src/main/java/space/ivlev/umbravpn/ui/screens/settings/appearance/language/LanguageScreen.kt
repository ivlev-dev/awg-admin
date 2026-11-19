package space.ivlev.umbravpn.ui.screens.settings.appearance.language

import androidx.appcompat.app.AppCompatDelegate
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.intl.Locale
import androidx.compose.ui.unit.dp
import java.text.Collator
import org.koin.compose.viewmodel.koinActivityViewModel
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.ui.common.button.SurfaceRow
import space.ivlev.umbravpn.util.LocaleUtil
import space.ivlev.umbravpn.viewmodel.SharedAppViewModel

@Composable
fun LanguageScreen(sharedViewModel: SharedAppViewModel = koinActivityViewModel()) {

    val collator = Collator.getInstance(Locale.current.platformLocale)
    val locales =
        LocaleUtil.supportedLocales.map {
            val tag = it.replace("_", "-")
            java.util.Locale.forLanguageTag(tag)
        }

    val sortedLocales =
        remember(locales) {
            locales.sortedWith(compareBy(collator) { it.getDisplayName(it) }).toList()
        }

    val lazyListState = rememberLazyListState()

    val currentLocale = AppCompatDelegate.getApplicationLocales().get(0)

    val selectedTag =
        remember(currentLocale, sortedLocales) {
            currentLocale?.let { current ->
                (sortedLocales.firstOrNull { it.toLanguageTag() == current.toLanguageTag() }
                        ?: sortedLocales.firstOrNull { it.language == current.language })
                    ?.toLanguageTag()
            }
        }

    val anyPartial = sortedLocales.any { !LocaleUtil.isFullyTranslated(it.toLanguageTag()) }
    val listOffset = if (anyPartial) 2 else 1

    val selectedIndex =
        remember(selectedTag, sortedLocales, listOffset) {
            if (selectedTag == null) 0
            else sortedLocales.indexOfFirst { it.toLanguageTag() == selectedTag } + listOffset
        }

    LaunchedEffect(selectedIndex) {
        if (selectedIndex >= 0) {
            lazyListState.scrollToItem(selectedIndex)
        }
    }

    LazyColumn(
        state = lazyListState,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Top,
    ) {
        item {
            SurfaceRow(
                title = stringResource(R.string.automatic),
                trailing =
                    if (currentLocale == null) {
                        {
                            Icon(
                                Icons.Outlined.Check,
                                stringResource(id = R.string.selected),
                                tint = MaterialTheme.colorScheme.primary,
                            )
                        }
                    } else null,
                onClick = { sharedViewModel.setLocale(LocaleUtil.OPTION_PHONE_LANGUAGE) },
            )
        }
        if (anyPartial) {
            item {
                Text(
                    text = stringResource(R.string.language_partial_warning),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }
        }
        items(sortedLocales, key = { it }, contentType = { "locale" }) { locale ->
            val buttonText =
                locale.getDisplayName(locale).replaceFirstChar {
                    if (it.isLowerCase()) it.titlecase(locale) else it.toString()
                }
            val tag = locale.toLanguageTag()
            val partial = !LocaleUtil.isFullyTranslated(tag)
            SurfaceRow(
                title = buttonText,
                description =
                    if (partial) {
                        {
                            Text(
                                text = stringResource(R.string.language_partial_badge),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    } else null,
                trailing =
                    if (selectedTag == tag) {
                        {
                            Icon(
                                Icons.Outlined.Check,
                                stringResource(id = R.string.selected),
                                tint = MaterialTheme.colorScheme.primary,
                            )
                        }
                    } else null,
                onClick = { sharedViewModel.setLocale(tag) },
            )
        }
    }
}
