package space.ivlev.umbravpn.di

import org.koin.core.module.dsl.singleOf
import org.koin.core.module.dsl.viewModel
import org.koin.core.module.dsl.viewModelOf
import org.koin.core.qualifier.named
import org.koin.dsl.bind
import org.koin.dsl.module
import space.ivlev.umbravpn.data.admin.AdminApi
import space.ivlev.umbravpn.data.network.AccountHttpClientFactory
import space.ivlev.umbravpn.data.repository.KtorAdminRepository
import space.ivlev.umbravpn.domain.repository.AdminRepository
import space.ivlev.umbravpn.viewmodel.AdminAuditViewModel
import space.ivlev.umbravpn.viewmodel.AdminGroupFormViewModel
import space.ivlev.umbravpn.viewmodel.AdminGroupsViewModel
import space.ivlev.umbravpn.viewmodel.AdminHubViewModel
import space.ivlev.umbravpn.viewmodel.AdminInterfaceFormViewModel
import space.ivlev.umbravpn.viewmodel.AdminInterfacesViewModel
import space.ivlev.umbravpn.viewmodel.AdminNodeFormViewModel
import space.ivlev.umbravpn.viewmodel.AdminNodesViewModel
import space.ivlev.umbravpn.viewmodel.AdminPoolFormViewModel
import space.ivlev.umbravpn.viewmodel.AdminPoolsViewModel
import space.ivlev.umbravpn.viewmodel.AdminSettingsViewModel
import space.ivlev.umbravpn.viewmodel.AdminStatsViewModel
import space.ivlev.umbravpn.viewmodel.AdminTariffFormViewModel
import space.ivlev.umbravpn.viewmodel.AdminTariffsViewModel
import space.ivlev.umbravpn.viewmodel.AdminUserFormViewModel
import space.ivlev.umbravpn.viewmodel.AdminUsersViewModel

val adminModule = module {
    single {
        AdminApi(
            client = get(named(ACCOUNT_HTTP_CLIENT)),
            json = AccountHttpClientFactory.json,
            sessionManager = get(),
            settings = get(),
        )
    }
    singleOf(::KtorAdminRepository) bind AdminRepository::class

    viewModelOf(::AdminHubViewModel)
    viewModelOf(::AdminAuditViewModel)
    viewModelOf(::AdminStatsViewModel)
    viewModelOf(::AdminSettingsViewModel)
    viewModelOf(::AdminUsersViewModel)
    viewModelOf(::AdminTariffsViewModel)
    viewModelOf(::AdminNodesViewModel)
    viewModelOf(::AdminInterfacesViewModel)
    viewModelOf(::AdminGroupsViewModel)
    viewModel { (id: String?) -> AdminUserFormViewModel(get(), get(), id) }
    viewModel { (id: String?) -> AdminTariffFormViewModel(get(), get(), id) }
    viewModelOf(::AdminNodeFormViewModel)
    viewModel { (id: String?) -> AdminInterfaceFormViewModel(get(), get(), id) }
    viewModel { (id: String?) -> AdminGroupFormViewModel(get(), get(), id) }
    viewModel { (groupId: String) -> AdminPoolsViewModel(get(), get(), groupId) }
    viewModel { (groupId: String, id: String?) ->
        AdminPoolFormViewModel(get(), get(), groupId, id)
    }
}
