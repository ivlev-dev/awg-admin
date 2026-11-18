package space.ivlev.umbravpn.di

import org.koin.androidx.workmanager.dsl.workerOf
import org.koin.dsl.module
import space.ivlev.umbravpn.core.worker.ManagedTunnelSyncWorker
import space.ivlev.umbravpn.core.worker.UpdateCheckWorker

val workerModule = module {
    workerOf(::UpdateCheckWorker)
    workerOf(::ManagedTunnelSyncWorker)
}
