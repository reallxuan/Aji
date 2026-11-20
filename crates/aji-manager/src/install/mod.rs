//! Installing an engine: the folders under `app_local_data_dir`, downloading, free space,
//! unpacking and the record of what is installed.

mod classify;
mod download;
mod layout;
mod record;
mod smoke;
mod source;
mod space;
mod unpack;

pub use classify::*;
pub use download::*;
pub use layout::*;
pub use record::*;
pub use smoke::*;
pub use source::*;
pub use space::*;
pub use unpack::*;
