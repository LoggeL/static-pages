use crate::project_snapshot::{
    Artifact, ArtifactOrigin, CapabilityGap, CreateProjectSnapshotRequest, ProjectSnapshotResult,
    SnapshotCancellation, SnapshotStatus,
};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs::{self, File},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};

const SCHEMA_VERSION: &str = "1.0";
const PART_PROFILE_ID: &str = "solid-edge-native-step-pdf-bom-v2";
const ASSEMBLY_PROFILE_ID: &str = "solid-edge-native-step-pdf-bom-deps-v3";
const NATIVE_EXTENSIONS: &[&str] = &["par", "asm", "dft"];

#[derive(Serialize)]
struct Manifest<'a> {
    schema_version: &'static str,
    bundle_type: &'static str,
    correlation_id: &'a str,
    created_at: String,
    status: SnapshotStatus,
    project: ManifestProject<'a>,
    profile: ManifestProfile<'a>,
    artifacts: &'a [ManifestArtifact],
    capability_gaps: &'a [CapabilityGap],
    content_hash: &'a str,
}

#[derive(Serialize)]
struct ManifestProject<'a> {
    id: &'a str,
    name: &'a str,
    source_system: &'static str,
}

#[derive(Serialize)]
struct ManifestProfile<'a> {
    id: &'static str,
    solid_edge_version: &'a str,
    runtime_version: &'a str,
}

#[derive(Serialize)]
struct ManifestArtifact {
    relative_path: String,
    role: String,
    source_object: String,
    origin: ArtifactOrigin,
    size_bytes: u64,
    sha256: String,
}

impl From<&Artifact> for ManifestArtifact {
    fn from(value: &Artifact) -> Self {
        Self {
            relative_path: value.relative_path.clone(),
            role: value.role.clone(),
            source_object: value.source_object.clone(),
            origin: value.origin,
            size_bytes: value.size_bytes,
            sha256: value.sha256.clone(),
        }
    }
}

pub(crate) fn resolve_source_path(supplied: &Path) -> Result<PathBuf, String> {
    if has_dot_segment(supplied) || !supplied.is_absolute() || !has_native_extension(supplied) {
        return Err("invalid_solid_edge_source_path".to_owned());
    }
    reject_symlink(supplied)?;
    let canonical = supplied
        .canonicalize()
        .map_err(|_| "invalid_solid_edge_source_path".to_owned())?;
    if !canonical.is_file() {
        return Err("invalid_solid_edge_source_path".to_owned());
    }
    reject_symlink(
        canonical
            .parent()
            .ok_or_else(|| "invalid_solid_edge_source_path".to_owned())?,
    )?;
    Ok(canonical)
}

pub(crate) fn create_solid_edge_snapshot_cancellable(
    workspace_parent: &Path,
    request: CreateProjectSnapshotRequest,
    selected_document: &Path,
    runtime_version: &str,
    cancellation: &SnapshotCancellation,
) -> Result<ProjectSnapshotResult, String> {
    validate_request(&request)?;
    cancellation.check()?;
    let selected = resolve_source_path(selected_document)?;
    let source_root = selected
        .parent()
        .ok_or_else(|| "invalid_solid_edge_source_path".to_owned())?;
    let stem = selected
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "invalid_solid_edge_source_path".to_owned())?;
    let assembly_snapshot = selected
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("asm"));
    let native = native_documents(source_root, stem, assembly_snapshot)?;
    let step = required_companion(source_root, stem, &["stp", "step"], "step_output_missing")?;
    let pdf = required_companion(source_root, stem, &["pdf"], "pdf_output_missing")?;
    let metadata = source_root.join(format!("{stem}.metadata.json"));
    reject_regular_file(&metadata, "metadata_output_missing")?;
    verify_prefix(&step, b"ISO-10303-21", "step_output_invalid")?;
    verify_prefix(&pdf, b"%PDF-", "pdf_output_invalid")?;
    let (redacted_metadata, solid_edge_version) = read_redacted_metadata(&metadata)?;
    let generated_companions = if assembly_snapshot {
        let bom_json = exact_companion(
            source_root,
            &format!("{stem}.bom.json"),
            "assembly_bom_json_missing",
        )?;
        let bom_csv = exact_companion(
            source_root,
            &format!("{stem}.bom.csv"),
            "assembly_bom_csv_missing",
        )?;
        let analysis = exact_companion(
            source_root,
            &format!("{stem}.analysis.json"),
            "object_analysis_missing",
        )?;
        validate_bom_json(&bom_json)?;
        validate_bom_csv(&bom_csv)?;
        validate_analysis_json(&analysis)?;
        let dependencies = exact_companion(
            source_root,
            &format!("{stem}.dependencies.json"),
            "dependency_graph_missing",
        )?;
        validate_dependency_json(&dependencies, source_root, stem, &native, cancellation)?;
        vec![
            (bom_json, "engineering_bom_json"),
            (bom_csv, "engineering_bom_csv"),
            (analysis, "object_analysis"),
            (dependencies, "dependency_graph"),
        ]
    } else {
        Vec::new()
    };

    let workspace = controlled_workspace(workspace_parent)?;
    let project_dir = workspace.join("bundles").join(&request.project_id);
    fs::create_dir_all(&project_dir).map_err(io_error)?;
    reject_symlink(&project_dir)?;
    let final_dir = project_dir.join(&request.correlation_id);
    let staging_dir = workspace
        .join("staging")
        .join(format!("{}.partial", request.correlation_id));
    if occupied(&final_dir) || occupied(&staging_dir) {
        return Err("snapshot_bundle_already_exists".to_owned());
    }
    fs::create_dir(&staging_dir).map_err(io_error)?;

    let result = build_staging(
        &staging_dir,
        &request,
        &native,
        &step,
        &pdf,
        &metadata,
        &redacted_metadata,
        &generated_companions,
        assembly_snapshot,
        &solid_edge_version,
        runtime_version,
        cancellation,
    );
    let mut result = match result {
        Ok(result) => result,
        Err(error) => {
            let _ = fs::remove_dir_all(&staging_dir);
            return Err(error);
        }
    };
    if cancellation.is_cancelled() {
        let _ = fs::remove_dir_all(&staging_dir);
        return Err("snapshot_cancelled".to_owned());
    }
    fs::rename(&staging_dir, &final_dir).map_err(io_error)?;
    result.bundle_path = final_dir;
    Ok(result)
}

#[allow(clippy::too_many_arguments)]
fn build_staging(
    root: &Path,
    request: &CreateProjectSnapshotRequest,
    native: &[PathBuf],
    step: &Path,
    pdf: &Path,
    metadata_source: &Path,
    redacted_metadata: &[u8],
    generated_companions: &[(PathBuf, &'static str)],
    assembly_snapshot: bool,
    solid_edge_version: &str,
    runtime_version: &str,
    cancellation: &SnapshotCancellation,
) -> Result<ProjectSnapshotResult, String> {
    let source_dir = root.join("source");
    let generated_dir = root.join("generated");
    fs::create_dir(&source_dir).map_err(io_error)?;
    fs::create_dir(&generated_dir).map_err(io_error)?;

    let mut artifacts = Vec::new();
    for source in native {
        cancellation.check()?;
        let name = file_name(source)?;
        let destination = source_dir.join(name);
        copy_cancellable(source, &destination, cancellation)?;
        artifacts.push(artifact(
            root,
            &destination,
            native_role(source),
            name,
            ArtifactOrigin::Native,
            cancellation,
        )?);
    }

    let step_name = file_name(step)?;
    let staged_step = generated_dir.join(step_name);
    copy_cancellable(step, &staged_step, cancellation)?;
    artifacts.push(artifact(
        root,
        &staged_step,
        "step",
        step_name,
        ArtifactOrigin::Generated,
        cancellation,
    )?);

    for (source, role) in generated_companions {
        cancellation.check()?;
        let name = file_name(source)?;
        let destination = generated_dir.join(name);
        copy_cancellable(source, &destination, cancellation)?;
        artifacts.push(artifact(
            root,
            &destination,
            role,
            name,
            ArtifactOrigin::Generated,
            cancellation,
        )?);
    }

    let pdf_name = file_name(pdf)?;
    let staged_pdf = generated_dir.join(pdf_name);
    copy_cancellable(pdf, &staged_pdf, cancellation)?;
    artifacts.push(artifact(
        root,
        &staged_pdf,
        "drawing_pdf",
        pdf_name,
        ArtifactOrigin::Generated,
        cancellation,
    )?);

    let metadata_name = file_name(metadata_source)?;
    let staged_metadata = generated_dir.join(metadata_name);
    let mut file = File::create(&staged_metadata).map_err(io_error)?;
    file.write_all(redacted_metadata).map_err(io_error)?;
    file.sync_all().map_err(io_error)?;
    artifacts.push(artifact(
        root,
        &staged_metadata,
        "redacted_metadata",
        metadata_name,
        ArtifactOrigin::Generated,
        cancellation,
    )?);

    artifacts.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    let content_hash = content_hash(&artifacts);
    let mut gaps = vec![CapabilityGap {
        capability: "unsaved_editor_state".to_owned(),
        required: false,
        reason: "disk_backed_source_only_unsaved_editor_changes_excluded".to_owned(),
    }];
    if !assembly_snapshot {
        gaps.push(CapabilityGap {
            capability: "assembly_bom".to_owned(),
            required: false,
            reason: "not_applicable_to_part_snapshot".to_owned(),
        });
    }
    let manifest_artifacts: Vec<_> = artifacts.iter().map(ManifestArtifact::from).collect();
    let manifest = Manifest {
        schema_version: SCHEMA_VERSION,
        bundle_type: "project_snapshot",
        correlation_id: &request.correlation_id,
        created_at: time::OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .map_err(|_| "snapshot_manifest_time_failed".to_owned())?,
        status: SnapshotStatus::Verified,
        project: ManifestProject {
            id: &request.project_id,
            name: &request.project_name,
            source_system: "solid_edge",
        },
        profile: ManifestProfile {
            id: if assembly_snapshot {
                ASSEMBLY_PROFILE_ID
            } else {
                PART_PROFILE_ID
            },
            solid_edge_version,
            runtime_version,
        },
        artifacts: &manifest_artifacts,
        capability_gaps: &gaps,
        content_hash: &content_hash,
    };
    let manifest_bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|_| "snapshot_manifest_serialize_failed".to_owned())?;
    let mut file = File::create(root.join("manifest.json")).map_err(io_error)?;
    file.write_all(&manifest_bytes).map_err(io_error)?;
    file.sync_all().map_err(io_error)?;

    Ok(ProjectSnapshotResult {
        schema_version: SCHEMA_VERSION.to_owned(),
        status: SnapshotStatus::Verified,
        correlation_id: request.correlation_id.clone(),
        bundle_id: request.correlation_id.clone(),
        content_hash,
        artifacts,
        capability_gaps: gaps,
        bundle_path: PathBuf::new(),
    })
}

fn validate_request(request: &CreateProjectSnapshotRequest) -> Result<(), String> {
    if request.source_system != "solid_edge" {
        return Err("invalid_source_system".to_owned());
    }
    if !crate::dialog_host::is_uuid(&request.correlation_id) {
        return Err("invalid_correlation_id".to_owned());
    }
    let id = request.project_id.as_bytes();
    if !(3..=64).contains(&id.len())
        || !id.first().is_some_and(u8::is_ascii_alphanumeric)
        || !id.last().is_some_and(u8::is_ascii_alphanumeric)
        || !id
            .iter()
            .all(|value| value.is_ascii_lowercase() || value.is_ascii_digit() || *value == b'-')
    {
        return Err("invalid_project_id".to_owned());
    }
    let name = &request.project_name;
    if !(2..=80).contains(&name.chars().count())
        || name.trim() != name
        || name.chars().any(|value| {
            value.is_control()
                || matches!(value, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
        })
    {
        return Err("invalid_project_name".to_owned());
    }
    Ok(())
}

fn native_documents(
    root: &Path,
    stem: &str,
    include_assembly_dependencies: bool,
) -> Result<Vec<PathBuf>, String> {
    let mut result = Vec::new();
    for entry in fs::read_dir(root).map_err(io_error)? {
        let path = entry.map_err(io_error)?.path();
        let metadata = fs::symlink_metadata(&path).map_err(io_error)?;
        if metadata.file_type().is_symlink() {
            return Err("symlink_not_allowed".to_owned());
        }
        let same_stem = path.file_stem().and_then(|value| value.to_str()) == Some(stem);
        if metadata.is_file()
            && has_native_extension(&path)
            && (same_stem || include_assembly_dependencies)
        {
            result.push(path.canonicalize().map_err(io_error)?);
        }
    }
    result.sort();
    if result.is_empty() {
        Err("solid_edge_native_source_missing".to_owned())
    } else {
        Ok(result)
    }
}

fn exact_companion(root: &Path, name: &str, missing_code: &str) -> Result<PathBuf, String> {
    let path = root.join(name);
    reject_regular_file(&path, missing_code)?;
    path.canonicalize().map_err(io_error)
}

fn validate_bom_json(path: &Path) -> Result<(), String> {
    let value = read_json_value(path, "assembly_bom_json_invalid")?;
    let lines = value
        .get("lines")
        .and_then(Value::as_array)
        .ok_or_else(|| "assembly_bom_json_invalid".to_owned())?;
    let line_count = value
        .get("line_count")
        .and_then(Value::as_u64)
        .ok_or_else(|| "assembly_bom_json_invalid".to_owned())?;
    let occurrence_count = value
        .get("occurrence_count")
        .and_then(Value::as_u64)
        .ok_or_else(|| "assembly_bom_json_invalid".to_owned())?;
    if value.get("source_system").and_then(Value::as_str) != Some("solid_edge")
        || line_count == 0
        || occurrence_count == 0
        || usize::try_from(line_count).ok() != Some(lines.len())
        || lines.iter().any(|line| {
            line.get("PartNumber")
                .and_then(Value::as_str)
                .is_none_or(str::is_empty)
                || line.get("Quantity").and_then(Value::as_u64).unwrap_or(0) == 0
        })
    {
        return Err("assembly_bom_json_invalid".to_owned());
    }
    Ok(())
}

fn validate_bom_csv(path: &Path) -> Result<(), String> {
    let csv = fs::read_to_string(path).map_err(io_error)?;
    let mut lines = csv.lines();
    let header = lines
        .next()
        .ok_or_else(|| "assembly_bom_csv_invalid".to_owned())?;
    let normalized_header = header.to_ascii_lowercase();
    let has_part_number =
        normalized_header.contains("partnumber") || normalized_header.contains("part_number");
    if !has_part_number || !normalized_header.contains("quantity") || lines.next().is_none() {
        return Err("assembly_bom_csv_invalid".to_owned());
    }
    Ok(())
}

fn validate_analysis_json(path: &Path) -> Result<(), String> {
    let value = read_json_value(path, "object_analysis_invalid")?;
    let Some(inventory) = value.get("object_inventory").and_then(Value::as_object) else {
        return Err("object_analysis_invalid".to_owned());
    };
    if value.get("source_system").and_then(Value::as_str) != Some("solid_edge")
        || value
            .get("field_provenance")
            .and_then(Value::as_object)
            .is_none()
    {
        return Err("object_analysis_invalid".to_owned());
    }
    match inventory.get("cycle_count").and_then(Value::as_u64) {
        Some(0) => {}
        Some(_) => return Err("assembly_cycle_detected".to_owned()),
        None => return Err("object_analysis_invalid".to_owned()),
    }
    match inventory.get("hierarchy_depth").and_then(Value::as_u64) {
        Some(depth) if depth <= 64 => {}
        Some(_) => return Err("assembly_recursion_limit_exceeded".to_owned()),
        None => return Err("object_analysis_invalid".to_owned()),
    }
    Ok(())
}

fn validate_dependency_json(
    path: &Path,
    source_root: &Path,
    stem: &str,
    native: &[PathBuf],
    cancellation: &SnapshotCancellation,
) -> Result<(), String> {
    let value = read_json_value(path, "dependency_graph_invalid")?;
    let links = value
        .get("links")
        .and_then(Value::as_array)
        .ok_or_else(|| "dependency_graph_invalid".to_owned())?;
    let link_count = value
        .get("link_count")
        .and_then(Value::as_u64)
        .and_then(|count| usize::try_from(count).ok())
        .ok_or_else(|| "dependency_graph_invalid".to_owned())?;
    let declared_canonical_hash = value
        .get("canonical_sha256")
        .and_then(Value::as_str)
        .filter(|hash| is_sha256(hash))
        .ok_or_else(|| "dependency_graph_invalid".to_owned())?;
    let root_document = format!("{stem}.asm");
    if value.get("schema_version").and_then(Value::as_str) != Some("1.0")
        || value.get("source_system").and_then(Value::as_str) != Some("solid_edge")
        || value.get("graph_kind").and_then(Value::as_str) != Some("native_document_dependencies")
        || value.get("root_document").and_then(Value::as_str) != Some(root_document.as_str())
        || links.is_empty()
        || links.len() != link_count
    {
        return Err("dependency_graph_invalid".to_owned());
    }

    let mut native_by_name = HashMap::new();
    for native_path in native {
        let name = file_name(native_path)?.to_owned();
        if native_by_name
            .insert(name.to_ascii_lowercase(), native_path.clone())
            .is_some()
        {
            return Err("dependency_graph_duplicate_native".to_owned());
        }
    }
    let expected_documents: HashSet<_> = native_by_name
        .iter()
        .filter(|(_, path)| {
            !path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("dft"))
        })
        .map(|(name, _)| name.clone())
        .collect();

    let mut seen_edges = HashSet::new();
    let mut canonical_rows = Vec::with_capacity(links.len());
    let mut adjacency: HashMap<String, Vec<String>> = HashMap::new();
    for link in links {
        cancellation.check()?;
        let source = dependency_field(link, "source_document")?;
        let target = dependency_field(link, "target_document")?;
        if !is_native_dependency_name(source, true) || !is_native_dependency_name(target, false) {
            return Err("dependency_graph_path_invalid".to_owned());
        }
        let source_key = source.to_ascii_lowercase();
        let target_key = target.to_ascii_lowercase();
        let source_path = native_by_name
            .get(&source_key)
            .ok_or_else(|| "dependency_graph_source_missing".to_owned())?;
        let target_path = native_by_name
            .get(&target_key)
            .ok_or_else(|| "dependency_graph_target_missing".to_owned())?;
        if !source_path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("asm"))
            || !target_path.starts_with(source_root)
            || !source_path.starts_with(source_root)
        {
            return Err("dependency_graph_path_invalid".to_owned());
        }
        let edge_key = format!("{source_key}\0{target_key}");
        if !seen_edges.insert(edge_key) {
            return Err("dependency_graph_duplicate_edge".to_owned());
        }
        let occurrence_references = link
            .get("occurrence_references")
            .and_then(Value::as_u64)
            .ok_or_else(|| "dependency_graph_invalid".to_owned())?;
        let declared_size = link
            .get("target_size_bytes")
            .and_then(Value::as_u64)
            .ok_or_else(|| "dependency_graph_invalid".to_owned())?;
        let declared_hash = dependency_field(link, "target_sha256")?;
        let expected_role = if target
            .rsplit_once('.')
            .is_some_and(|(_, extension)| extension.eq_ignore_ascii_case("asm"))
        {
            "assembly"
        } else {
            "part"
        };
        if link.get("target_role").and_then(Value::as_str) != Some(expected_role)
            || link.get("exists").and_then(Value::as_bool) != Some(true)
            || link.get("local").and_then(Value::as_bool) != Some(true)
            || !is_sha256(declared_hash)
            || fs::metadata(target_path).map_err(io_error)?.len() != declared_size
            || sha256_file(target_path, cancellation)? != declared_hash.to_ascii_lowercase()
        {
            return Err("dependency_graph_target_mismatch".to_owned());
        }
        canonical_rows.push((
            source.to_owned(),
            target.to_owned(),
            declared_hash.to_ascii_lowercase(),
            occurrence_references,
        ));
        adjacency.entry(source_key).or_default().push(target_key);
    }

    canonical_rows.sort_by(|left, right| {
        left.0
            .to_ascii_lowercase()
            .cmp(&right.0.to_ascii_lowercase())
            .then_with(|| {
                left.1
                    .to_ascii_lowercase()
                    .cmp(&right.1.to_ascii_lowercase())
            })
    });
    let mut digest = Sha256::new();
    for (source, target, target_hash, occurrence_references) in &canonical_rows {
        digest.update(source.as_bytes());
        digest.update([0]);
        digest.update(target.as_bytes());
        digest.update([0]);
        digest.update(target_hash.as_bytes());
        digest.update([0]);
        digest.update(occurrence_references.to_string().as_bytes());
        digest.update(b"\n");
    }
    if format!("{:x}", digest.finalize()) != declared_canonical_hash.to_ascii_lowercase() {
        return Err("dependency_graph_hash_mismatch".to_owned());
    }

    let root_key = root_document.to_ascii_lowercase();
    let mut reachable = HashSet::new();
    let mut queue = VecDeque::from([root_key]);
    while let Some(document) = queue.pop_front() {
        if !reachable.insert(document.clone()) {
            continue;
        }
        if let Some(targets) = adjacency.get(&document) {
            queue.extend(targets.iter().cloned());
        }
    }
    if reachable != expected_documents {
        return Err("dependency_graph_incomplete".to_owned());
    }
    Ok(())
}

fn dependency_field<'a>(value: &'a Value, field: &str) -> Result<&'a str, String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "dependency_graph_invalid".to_owned())
}

fn is_native_dependency_name(value: &str, assembly_only: bool) -> bool {
    if value.contains(['/', '\\', ':'])
        || value.starts_with('.')
        || Path::new(value).file_name().and_then(|name| name.to_str()) != Some(value)
    {
        return false;
    }
    let extension = Path::new(value)
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default();
    extension.eq_ignore_ascii_case("asm")
        || (!assembly_only && extension.eq_ignore_ascii_case("par"))
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn required_companion(
    root: &Path,
    stem: &str,
    extensions: &[&str],
    missing_code: &str,
) -> Result<PathBuf, String> {
    let mut matches = Vec::new();
    for entry in fs::read_dir(root).map_err(io_error)? {
        let path = entry.map_err(io_error)?.path();
        let metadata = fs::symlink_metadata(&path).map_err(io_error)?;
        if metadata.file_type().is_symlink() {
            return Err("symlink_not_allowed".to_owned());
        }
        let matches_extension = path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| {
                extensions
                    .iter()
                    .any(|item| value.eq_ignore_ascii_case(item))
            });
        if metadata.is_file()
            && path.file_stem().and_then(|value| value.to_str()) == Some(stem)
            && matches_extension
        {
            matches.push(path);
        }
    }
    match matches.as_slice() {
        [path] => Ok(path.clone()),
        [] => Err(missing_code.to_owned()),
        _ => Err(format!("{missing_code}_ambiguous")),
    }
}

fn read_redacted_metadata(path: &Path) -> Result<(Vec<u8>, String), String> {
    let mut value = read_json_value(path, "metadata_output_invalid")?;
    if value.get("source_system").and_then(Value::as_str) != Some("solid_edge") {
        return Err("metadata_source_system_invalid".to_owned());
    }
    let version = value
        .get("source_version")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .ok_or_else(|| "solid_edge_version_missing".to_owned())?
        .to_owned();
    redact_value(&mut value);
    serde_json::to_vec_pretty(&value)
        .map(|bytes| (bytes, version))
        .map_err(|_| "metadata_output_invalid".to_owned())
}

fn read_json_value(path: &Path, invalid_code: &str) -> Result<Value, String> {
    let bytes = fs::read(path).map_err(io_error)?;
    let json = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes);
    serde_json::from_slice(json).map_err(|_| invalid_code.to_owned())
}

fn redact_value(value: &mut Value) {
    match value {
        Value::Object(map) => {
            for (key, item) in map {
                let key = key.to_ascii_lowercase();
                if [
                    "password",
                    "secret",
                    "token",
                    "authorization",
                    "api_key",
                    "email",
                ]
                .iter()
                .any(|sensitive| key.contains(sensitive))
                {
                    *item = Value::String("[REDACTED]".to_owned());
                } else {
                    redact_value(item);
                }
            }
        }
        Value::Array(items) => items.iter_mut().for_each(redact_value),
        _ => {}
    }
}

fn artifact(
    root: &Path,
    path: &Path,
    role: &str,
    source_object: &str,
    origin: ArtifactOrigin,
    cancellation: &SnapshotCancellation,
) -> Result<Artifact, String> {
    let relative_path = relative_path(root, path)?;
    let size_bytes = fs::metadata(path).map_err(io_error)?.len();
    let sha256 = sha256_file(path, cancellation)?;
    Ok(Artifact {
        relative_path,
        role: role.to_owned(),
        source_object: source_object.to_owned(),
        origin,
        size_bytes,
        sha256,
    })
}

fn native_role(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "par" => "solid_edge_part",
        "asm" => "solid_edge_assembly",
        "dft" => "solid_edge_draft",
        _ => "solid_edge_native",
    }
}

fn content_hash(artifacts: &[Artifact]) -> String {
    let mut digest = Sha256::new();
    for artifact in artifacts {
        digest.update(artifact.relative_path.as_bytes());
        digest.update([0]);
        digest.update(artifact.role.as_bytes());
        digest.update([0]);
        digest.update(artifact.sha256.as_bytes());
        digest.update([0]);
        digest.update(artifact.size_bytes.to_le_bytes());
    }
    format!("{:x}", digest.finalize())
}

fn sha256_file(path: &Path, cancellation: &SnapshotCancellation) -> Result<String, String> {
    let mut file = File::open(path).map_err(io_error)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 32 * 1024];
    loop {
        cancellation.check()?;
        let read = file.read(&mut buffer).map_err(io_error)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn copy_cancellable(
    source: &Path,
    destination: &Path,
    cancellation: &SnapshotCancellation,
) -> Result<(), String> {
    let mut reader = File::open(source).map_err(io_error)?;
    let mut writer = File::create(destination).map_err(io_error)?;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        cancellation.check()?;
        let read = reader.read(&mut buffer).map_err(io_error)?;
        if read == 0 {
            break;
        }
        writer.write_all(&buffer[..read]).map_err(io_error)?;
    }
    writer.sync_all().map_err(io_error)
}

fn controlled_workspace(parent: &Path) -> Result<PathBuf, String> {
    reject_symlink(parent)?;
    let parent = parent
        .canonicalize()
        .map_err(|_| "snapshot_workspace_unavailable".to_owned())?;
    let workspace = parent.join("project-snapshots-v1");
    fs::create_dir_all(workspace.join("bundles"))
        .and_then(|_| fs::create_dir_all(workspace.join("staging")))
        .map_err(|_| "snapshot_workspace_unavailable".to_owned())?;
    reject_symlink(&workspace)?;
    Ok(workspace)
}

fn verify_prefix(path: &Path, expected: &[u8], code: &str) -> Result<(), String> {
    let mut file = File::open(path).map_err(io_error)?;
    let mut prefix = vec![0_u8; expected.len()];
    file.read_exact(&mut prefix).map_err(|_| code.to_owned())?;
    if prefix == expected {
        Ok(())
    } else {
        Err(code.to_owned())
    }
}

fn reject_regular_file(path: &Path, code: &str) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| code.to_owned())?;
    if metadata.file_type().is_symlink() {
        Err("symlink_not_allowed".to_owned())
    } else if metadata.is_file() {
        Ok(())
    } else {
        Err(code.to_owned())
    }
}

fn reject_symlink(path: &Path) -> Result<(), String> {
    if path.exists()
        && fs::symlink_metadata(path)
            .map_err(io_error)?
            .file_type()
            .is_symlink()
    {
        return Err("symlink_not_allowed".to_owned());
    }
    Ok(())
}

fn relative_path(root: &Path, path: &Path) -> Result<String, String> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| "project_path_traversal".to_owned())?;
    let mut parts = Vec::new();
    for component in relative.components() {
        match component {
            Component::Normal(value) => parts.push(value.to_string_lossy().into_owned()),
            _ => return Err("project_path_traversal".to_owned()),
        }
    }
    Ok(parts.join("/"))
}

fn file_name(path: &Path) -> Result<&str, String> {
    path.file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "invalid_solid_edge_source_path".to_owned())
}

fn has_native_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| {
            NATIVE_EXTENSIONS
                .iter()
                .any(|item| value.eq_ignore_ascii_case(item))
        })
}

fn has_dot_segment(path: &Path) -> bool {
    path.to_string_lossy()
        .split(['/', '\\'])
        .any(|segment| matches!(segment, "." | ".."))
}

fn occupied(path: &Path) -> bool {
    match fs::symlink_metadata(path) {
        Ok(_) => true,
        Err(error) => error.kind() != std::io::ErrorKind::NotFound,
    }
}

fn io_error(_: std::io::Error) -> String {
    "snapshot_io_error".to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    struct TestArea(PathBuf);

    impl TestArea {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("iv-solid-edge-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }

        fn fixture(&self) -> PathBuf {
            let part = self.0.join("IV_Demo_Block.par");
            fs::write(&part, b"native-part").unwrap();
            fs::write(self.0.join("IV_Demo_Block.dft"), b"native-draft").unwrap();
            fs::write(
                self.0.join("IV_Demo_Block.stp"),
                b"ISO-10303-21;\nMANIFOLD_SOLID_BREP",
            )
            .unwrap();
            fs::write(self.0.join("IV_Demo_Block.pdf"), b"%PDF-1.7\nfixture").unwrap();
            fs::write(
                self.0.join("IV_Demo_Block.metadata.json"),
                br#"{"schema_version":"1.0","source_system":"solid_edge","source_version":"226.00.00.106","email":"private@example.test","nested":{"api_token":"secret"}}"#,
            )
            .unwrap();
            part
        }

        fn assembly_fixture(&self) -> PathBuf {
            let assembly = self.0.join("IV_InnovaVento_Oven.asm");
            fs::write(&assembly, b"native-assembly").unwrap();
            fs::write(self.0.join("IV_OVN_SIDE.par"), b"native-side").unwrap();
            fs::write(self.0.join("IV_OVN_NAMEPLATE.par"), b"native-nameplate").unwrap();
            fs::write(self.0.join("IV_InnovaVento_Oven.dft"), b"native-draft").unwrap();
            fs::write(
                self.0.join("IV_InnovaVento_Oven.stp"),
                b"ISO-10303-21;\nMANIFOLD_SOLID_BREP",
            )
            .unwrap();
            fs::write(self.0.join("IV_InnovaVento_Oven.pdf"), b"%PDF-1.7\nfixture").unwrap();
            fs::write(
                self.0.join("IV_InnovaVento_Oven.metadata.json"),
                br#"{"schema_version":"2.0","source_system":"solid_edge","source_version":"226.00.00.106","document_type":"assembly"}"#,
            )
            .unwrap();
            fs::write(
                self.0.join("IV_InnovaVento_Oven.bom.json"),
                br#"{"schema_version":"1.0","source_system":"solid_edge","line_count":2,"occurrence_count":3,"lines":[{"PartNumber":"IV-OVN-1001","Quantity":2},{"PartNumber":"IV-OVN-9001","Quantity":1}]}"#,
            )
            .unwrap();
            fs::write(
                self.0.join("IV_InnovaVento_Oven.bom.csv"),
                b"Item,PartNumber,Quantity\n1,IV-OVN-1001,2\n2,IV-OVN-9001,1\n",
            )
            .unwrap();
            fs::write(
                self.0.join("IV_InnovaVento_Oven.analysis.json"),
                br#"{"schema_version":"1.0","source_system":"solid_edge","object_inventory":{"unique_components":2,"occurrences":3,"hierarchy_depth":1,"cycle_count":0},"field_provenance":{"structure":"AssemblyDocument.Occurrences"}}"#,
            )
            .unwrap();
            self.write_assembly_dependencies();
            assembly
        }

        fn write_assembly_dependencies(&self) {
            let root = "IV_InnovaVento_Oven.asm";
            let targets = ["IV_OVN_NAMEPLATE.par", "IV_OVN_SIDE.par"];
            let mut canonical = Vec::new();
            let mut links = Vec::new();
            for target in targets {
                let target_path = self.0.join(target);
                let target_hash =
                    sha256_file(&target_path, &SnapshotCancellation::default()).unwrap();
                canonical.extend_from_slice(root.as_bytes());
                canonical.push(0);
                canonical.extend_from_slice(target.as_bytes());
                canonical.push(0);
                canonical.extend_from_slice(target_hash.as_bytes());
                canonical.push(0);
                canonical.extend_from_slice(b"1\n");
                links.push(serde_json::json!({
                    "source_document": root,
                    "target_document": target,
                    "target_role": "part",
                    "occurrence_references": 1,
                    "exists": true,
                    "local": true,
                    "target_size_bytes": fs::metadata(&target_path).unwrap().len(),
                    "target_sha256": target_hash,
                }));
            }
            let canonical_sha256 = format!("{:x}", Sha256::digest(&canonical));
            fs::write(
                self.0.join("IV_InnovaVento_Oven.dependencies.json"),
                serde_json::to_vec(&serde_json::json!({
                    "schema_version": "1.0",
                    "source_system": "solid_edge",
                    "graph_kind": "native_document_dependencies",
                    "root_document": root,
                    "link_count": links.len(),
                    "canonical_sha256": canonical_sha256,
                    "links": links,
                }))
                .unwrap(),
            )
            .unwrap();
        }
    }

    impl Drop for TestArea {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn request(correlation: &str) -> CreateProjectSnapshotRequest {
        CreateProjectSnapshotRequest {
            correlation_id: correlation.to_owned(),
            project_id: "solid-edge-demo".to_owned(),
            project_name: "Solid Edge Demo".to_owned(),
            source_system: "solid_edge".to_owned(),
        }
    }

    #[test]
    fn rejects_non_solid_edge_source_extensions() {
        let area = TestArea::new();
        let source = area.0.join("demo.txt");
        fs::write(&source, b"nope").unwrap();
        assert_eq!(
            resolve_source_path(&source).unwrap_err(),
            "invalid_solid_edge_source_path"
        );
    }

    #[test]
    fn creates_verified_redacted_snapshot_with_deterministic_content_hash() {
        let first = TestArea::new();
        let first_source = first.fixture();
        let first_result = create_solid_edge_snapshot_cancellable(
            &first.0,
            request("d2c6477a-f37a-49b7-8b58-f3fd7833b056"),
            &first_source,
            "0.1.0",
            &SnapshotCancellation::default(),
        )
        .unwrap();
        let second = TestArea::new();
        let second_source = second.fixture();
        let second_result = create_solid_edge_snapshot_cancellable(
            &second.0,
            request("46e87265-6887-4745-9da3-f062e1669045"),
            &second_source,
            "0.1.0",
            &SnapshotCancellation::default(),
        )
        .unwrap();
        assert_eq!(first_result.status, SnapshotStatus::Verified);
        assert_eq!(first_result.content_hash, second_result.content_hash);
        assert_eq!(first_result.artifacts.len(), 5);
        let manifest: Value = serde_json::from_slice(
            &fs::read(first_result.bundle_path().join("manifest.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(manifest["project"]["source_system"], "solid_edge");
        assert_eq!(manifest["profile"]["solid_edge_version"], "226.00.00.106");
        let _package = crate::project_snapshot_flow::package_bundle(first_result.bundle_path())
            .expect("Solid Edge manifest and artifacts must pass the shared packager");
        let redacted = fs::read_to_string(
            first_result
                .bundle_path()
                .join("generated/IV_Demo_Block.metadata.json"),
        )
        .unwrap();
        assert!(!redacted.contains("private@example.test"));
        assert!(!redacted.contains("\"secret\""));
        assert!(redacted.contains("[REDACTED]"));
    }

    #[test]
    fn creates_assembly_snapshot_with_dependencies_bom_and_analysis() {
        let area = TestArea::new();
        let source = area.assembly_fixture();
        let result = create_solid_edge_snapshot_cancellable(
            &area.0,
            request("d68c6d6a-cda8-43c2-89ac-450231358255"),
            &source,
            "0.1.0",
            &SnapshotCancellation::default(),
        )
        .unwrap();

        assert_eq!(result.status, SnapshotStatus::Verified);
        assert_eq!(result.artifacts.len(), 11);
        assert!(result
            .artifacts
            .iter()
            .any(|item| item.role == "engineering_bom_json"));
        assert!(result
            .artifacts
            .iter()
            .any(|item| item.role == "engineering_bom_csv"));
        assert!(result
            .artifacts
            .iter()
            .any(|item| item.role == "object_analysis"));
        assert!(result
            .artifacts
            .iter()
            .any(|item| item.role == "dependency_graph"));
        assert!(!result
            .capability_gaps
            .iter()
            .any(|gap| gap.capability == "assembly_bom"));

        let manifest: Value =
            serde_json::from_slice(&fs::read(result.bundle_path().join("manifest.json")).unwrap())
                .unwrap();
        assert_eq!(
            manifest["profile"]["id"],
            "solid-edge-native-step-pdf-bom-deps-v3"
        );
        let _package = crate::project_snapshot_flow::package_bundle(result.bundle_path())
            .expect("assembly BOM snapshot must pass the shared packager");
    }

    #[test]
    fn rejects_assembly_analysis_with_cycle() {
        let area = TestArea::new();
        let source = area.assembly_fixture();
        fs::write(
            area.0.join("IV_InnovaVento_Oven.analysis.json"),
            br#"{"schema_version":"1.0","source_system":"solid_edge","object_inventory":{"unique_components":2,"occurrences":3,"hierarchy_depth":1,"cycle_count":1},"field_provenance":{"structure":"AssemblyDocument.Occurrences"}}"#,
        )
        .unwrap();

        assert_eq!(
            create_solid_edge_snapshot_cancellable(
                &area.0,
                request("582d6554-3612-4e48-befc-8532a1c79b31"),
                &source,
                "0.1.0",
                &SnapshotCancellation::default(),
            )
            .unwrap_err(),
            "assembly_cycle_detected"
        );
    }

    #[test]
    fn rejects_assembly_dependency_target_tampering() {
        let area = TestArea::new();
        let source = area.assembly_fixture();
        fs::write(area.0.join("IV_OVN_SIDE.par"), b"tampered-side").unwrap();

        assert_eq!(
            create_solid_edge_snapshot_cancellable(
                &area.0,
                request("3bfa8408-49f2-4444-9cb2-c9b253ef8c1b"),
                &source,
                "0.1.0",
                &SnapshotCancellation::default(),
            )
            .unwrap_err(),
            "dependency_graph_target_mismatch"
        );
    }

    #[test]
    fn rejects_assembly_analysis_over_recursion_limit() {
        let area = TestArea::new();
        let source = area.assembly_fixture();
        fs::write(
            area.0.join("IV_InnovaVento_Oven.analysis.json"),
            br#"{"schema_version":"1.0","source_system":"solid_edge","object_inventory":{"unique_components":2,"occurrences":3,"hierarchy_depth":65,"cycle_count":0},"field_provenance":{"structure":"AssemblyDocument.Occurrences"}}"#,
        )
        .unwrap();

        assert_eq!(
            create_solid_edge_snapshot_cancellable(
                &area.0,
                request("2b67f4f8-740d-47dd-b51e-86bc5a64b50c"),
                &source,
                "0.1.0",
                &SnapshotCancellation::default(),
            )
            .unwrap_err(),
            "assembly_recursion_limit_exceeded"
        );
    }

    #[test]
    #[ignore = "requires IV_SOLID_EDGE_E2E_DOCUMENT and real SaveALL companions"]
    fn real_solid_edge_snapshot_preserves_native_sources_and_verifies_exports() {
        let source = PathBuf::from(
            std::env::var("IV_SOLID_EDGE_E2E_DOCUMENT")
                .expect("IV_SOLID_EDGE_E2E_DOCUMENT must point to a .par/.asm/.dft file"),
        );
        let workspace = TestArea::new();
        let correlation_id = std::env::var("IV_PROJECT_SNAPSHOT_E2E_CORRELATION_ID")
            .unwrap_or_else(|_| "de6e093e-0a36-4321-8b51-b470d3f5676b".to_owned());
        let result = create_solid_edge_snapshot_cancellable(
            &workspace.0,
            request(&correlation_id),
            &source,
            "0.1.0",
            &SnapshotCancellation::default(),
        )
        .unwrap();
        assert_eq!(result.status, SnapshotStatus::Verified);
        assert!(result.artifacts.iter().any(|item| item.role == "step"));
        assert!(result
            .artifacts
            .iter()
            .any(|item| item.role == "drawing_pdf"));
        assert!(result.bundle_path().join("manifest.json").is_file());
        println!(
            "verified bundle_id={} content_hash={} artifacts={}",
            result.bundle_id,
            result.content_hash,
            result.artifacts.len()
        );
        if let Ok(base_url) = std::env::var("IV_PROJECT_SNAPSHOT_E2E_BASE_URL") {
            let api_token = std::env::var("IV_PROJECT_SNAPSHOT_E2E_API_TOKEN")
                .expect("IV_PROJECT_SNAPSHOT_E2E_API_TOKEN is required with the base URL");
            let user_id = std::env::var("IV_PROJECT_SNAPSHOT_E2E_USER")
                .unwrap_or_else(|_| "windows-vm-e2e".to_owned());
            let write_token = std::env::var("IV_PROJECT_SNAPSHOT_E2E_WRITE_TOKEN").ok();
            let evidence = crate::project_snapshot_flow::verify_server_flow(
                result.bundle_path(),
                &base_url,
                &api_token,
                write_token.as_deref(),
                &user_id,
            )
            .unwrap();
            println!(
                "server flow_id={} phase={:?} revision={} content_hash={} target_reference={}",
                evidence.flow_id,
                evidence.phase,
                evidence.revision,
                evidence.content_hash,
                evidence.external_reference.as_deref().unwrap_or("none")
            );
        }
    }
}
