package space.ivlev.umbravpn.account

import org.junit.Assert.assertEquals
import org.junit.Test
import space.ivlev.umbravpn.data.account.mapApiError
import space.ivlev.umbravpn.domain.account.AccountActionKind
import space.ivlev.umbravpn.domain.account.AccountMessage
import space.ivlev.umbravpn.domain.account.AccountMessages
import space.ivlev.umbravpn.domain.model.account.AccountError
import space.ivlev.umbravpn.domain.model.account.BlockReason

class AccountErrorMappingTest {
    @Test
    fun accountDisabledForbiddenMapsToBlockedError() {
        assertEquals(
            AccountError.Disabled(BlockReason.Disabled),
            mapApiError(403, errorBody("account_disabled", "account disabled")),
        )
    }

    @Test
    fun rejectedForbiddenMapsToRejectedBlockedError() {
        assertEquals(
            AccountError.Disabled(BlockReason.Rejected),
            mapApiError(403, errorBody("rejected", "registration rejected")),
        )
    }

    @Test
    fun tariffRequiredConflictMapsToDedicatedError() {
        assertEquals(
            AccountError.TariffRequired,
            mapApiError(409, errorBody("tariff_required", "tariff required")),
        )
    }

    @Test
    fun subscriptionInactiveForbiddenMapsToDedicatedError() {
        assertEquals(
            AccountError.SubscriptionInactive,
            mapApiError(403, errorBody("subscription_inactive", "subscription inactive")),
        )
    }

    @Test
    fun mappedErrorsProduceRussianReadyMessages() {
        assertEquals(
            AccountMessage.AccountDisabled,
            AccountMessages.of(AccountError.Disabled(BlockReason.Disabled)),
        )
        assertEquals(
            AccountMessage.Rejected,
            AccountMessages.of(AccountError.Disabled(BlockReason.Rejected)),
        )
        assertEquals(
            AccountMessage.TariffRequired,
            AccountMessages.of(AccountError.TariffRequired, AccountActionKind.Device),
        )
        assertEquals(
            AccountMessage.SubscriptionInactive,
            AccountMessages.of(AccountError.SubscriptionInactive),
        )
        assertEquals(
            AccountMessage.TariffRequired,
            AccountMessages.of(
                AccountError.Api(409, "tariff_required", "raw server text"),
                AccountActionKind.Device,
            ),
        )
    }

    @Test
    fun unknownForbiddenKeepsGenericMessage() {
        assertEquals(
            AccountError.Api(403, "mystery", "forbidden"),
            mapApiError(403, errorBody("mystery", "forbidden")),
        )
        assertEquals(
            AccountMessage.InvalidCredentials,
            AccountMessages.of(AccountError.Api(403, "mystery", "forbidden")),
        )
    }
}
