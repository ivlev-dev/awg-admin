use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportClientStatus {
    Create,
    Unchanged,
    Update,
    Duplicate,
    Error,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportClientChangeView {
    pub field: String,
    pub from: String,
    pub to: String,
}

#[derive(Debug, Serialize)]
pub struct ImportClientView {
    pub name: String,
    pub status: ImportClientStatus,
    pub address: Option<String>,
    pub reason: Option<String>,
    #[serde(default)]
    pub device_id: Option<Uuid>,
    #[serde(default)]
    pub changes: Vec<ImportClientChangeView>,
}

#[derive(Debug, Serialize)]
pub struct ImportServerPeerView {
    pub public_key: String,
    pub status: ImportClientStatus,
    pub address: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Default, Serialize)]
pub struct ImportCountsView {
    pub create: usize,
    pub unchanged: usize,
    pub update: usize,
    pub duplicate: usize,
    pub error: usize,
}

#[derive(Debug, Default, Serialize)]
pub struct ImportPeerCountsView {
    pub create: usize,
    pub duplicate: usize,
    pub error: usize,
}

#[derive(Debug, Serialize)]
pub struct ImportSummaryView {
    pub create: usize,
    pub unchanged: usize,
    pub update: usize,
    pub duplicate: usize,
    pub error: usize,
    pub interfaces: usize,
    pub external: ImportPeerCountsView,
}

#[derive(Debug, Serialize)]
pub struct ImportGroupView {
    pub name: String,
    pub base_cidr: String,
}

#[derive(Debug, Serialize)]
pub struct ImportInterfacePlanView {
    pub index: usize,
    pub name: String,
    pub public_key: String,
    pub clients: Vec<ImportClientView>,
    pub counts: ImportCountsView,
    pub server_peers: Vec<ImportServerPeerView>,
    pub server_peer_counts: ImportPeerCountsView,
}

#[derive(Debug, Serialize)]
pub struct ImportPreviewView {
    pub group: ImportGroupView,
    pub interfaces: Vec<ImportInterfacePlanView>,
    pub summary: ImportSummaryView,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct ImportCreatedInterfaceView {
    pub id: Uuid,
    pub name: String,
    pub device_ids: Vec<Uuid>,
    #[serde(default)]
    pub external_device_ids: Vec<Uuid>,
}

#[derive(Debug, Serialize)]
pub struct ImportCreatedView {
    pub group_id: Uuid,
    pub interfaces: Vec<ImportCreatedInterfaceView>,
}

#[derive(Debug, Serialize)]
pub struct ImportApplyView {
    #[serde(flatten)]
    pub preview: ImportPreviewView,
    pub created: ImportCreatedView,
}

#[derive(Debug, Serialize)]
pub struct ClientsImportInterfaceView {
    pub id: Uuid,
    pub name: String,
    pub group_id: Uuid,
    pub group_name: String,
    pub node_id: Uuid,
    pub public_key: String,
    pub clients: Vec<ImportClientView>,
    pub counts: ImportCountsView,
}

#[derive(Debug, Serialize)]
pub struct ClientsImportPreviewView {
    pub interfaces: Vec<ClientsImportInterfaceView>,
    pub summary: ImportSummaryView,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct ClientsImportCreatedInterfaceView {
    pub id: Uuid,
    pub device_ids: Vec<Uuid>,
    #[serde(default)]
    pub updated_device_ids: Vec<Uuid>,
}

#[derive(Debug, Serialize)]
pub struct ClientsImportCreatedView {
    pub interfaces: Vec<ClientsImportCreatedInterfaceView>,
}

#[derive(Debug, Serialize)]
pub struct ClientsImportApplyView {
    #[serde(flatten)]
    pub preview: ClientsImportPreviewView,
    pub created: ClientsImportCreatedView,
}
