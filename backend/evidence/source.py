"""Read generic document metadata while retaining legacy Circle run compatibility."""


def source_metadata(registry):
    source = registry.get("document") or registry.get("contract")
    if not source:
        raise ValueError("Registry must contain document metadata")
    return source


def verify_original_representation(source):
    """For Office, verify both the untouched original and locator mapping files."""
    from pathlib import Path
    from .prepare_circle import sha256
    for path_key, hash_key in (("original_file_path", "original_sha256"),
                               ("native_blocks_file", "native_blocks_sha256"),
                               ("native_package_path", "native_package_sha256")):
        if source.get(path_key) and sha256(Path(source[path_key])) != source[hash_key]:
            raise ValueError(f"Office source integrity mismatch: {path_key}")
