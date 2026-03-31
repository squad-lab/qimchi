# Custom Dataset Support

Qimchi backend is **xarray-first**.  
The extension model is: write a custom loader/provider that converts your format to `xr.Dataset` (or `xr.DataTree` later), then register it with the central loader.

## Extension API (already available)

From `backend/api/data_loader.py`:

- `DataProvider` protocol
- `LoadedData` return model
- `register_provider(provider, prepend=False)`
- `clear_custom_providers()`
- `load_xarray_dataset(path, fmt)` helper (uses Qimchi's standardized xarray loading/error mapping)

Main entrypoints used by endpoints:

- `load_data_sync(ref)`
- `load_data_async(ref)`
- `resolve_to_disk_path(ref)`

## Minimal Custom Provider Template

```python
# backend/api/custom_providers/my_format.py
from pathlib import Path
import xarray as xr

from api.data_loader import (
    DataProvider,
    LoadedData,
    DatasetResolutionError,
)


class MyFormatProvider:
    name = "my_format_provider"
    _suffixes = {".myfmt"}

    def supports(self, ref: str) -> bool:
        return Path(ref).suffix.lower() in self._suffixes

    def resolve_disk_path(self, ref: str) -> str:
        path = Path(ref)
        if not path.exists() or not path.is_file():
            raise DatasetResolutionError(f"Dataset file not found: {path}")
        return str(path)

    def _convert_to_xarray(self, path: Path) -> xr.Dataset:
        # TODO: parse your format and build xr.Dataset
        # return xr.Dataset(...)
        raise NotImplementedError

    def load_sync(self, ref: str) -> LoadedData:
        path = Path(self.resolve_disk_path(ref))
        ds = self._convert_to_xarray(path)
        ds.attrs["path"] = ref
        ds.attrs["loaded_from"] = "disk"
        ds.attrs["actual_path"] = str(path)

        return LoadedData(
            kind="dataset",
            obj=ds,
            source_ref=ref,
            actual_path=str(path),
            format="myfmt",
            loaded_from="disk",
            metadata={},
        )

    async def load_async(self, ref: str) -> LoadedData:
        return self.load_sync(ref)
```

## Registering the Provider

Register once at backend startup (for example in `backend/main.py` before requests start):

```python
from api.data_loader import register_provider
from api.custom_providers.my_format import MyFormatProvider

register_provider(MyFormatProvider(), prepend=True)
```

Use `prepend=True` so your provider is checked before builtin providers.

## If Your Source Can Be Converted to Standard Xarray Files

If your pipeline can produce `.zarr`, `.nc`, `.h5`, or `.hdf5`, prefer that:

1. Convert your data to one of those formats.
2. Let Qimchi load it via builtin providers (`load_xarray_dataset(...)` path).

This is the easiest and most stable integration path.

## Examples in Current Codebase

- Flat tables (`.csv/.txt/.dat`): `FlatFmtProvider` in `backend/api/data_loader.py`
  - Validity rule: file must be readable by `polars.read_csv`.
  - Converted to xarray coordinates for plotting/metadata compatibility.

- QCoDeS sqlite (`.db/.sqlite`): `QcodesSqliteProvider` in `backend/api/data_loader.py`
  - Uses `qcodes.dataset.load_by_id(...).to_xarray_dataset()`.

- NetCDF/HDF5: `NetcdfHdf5Provider` in `backend/api/data_loader.py`
  - Uses xarray engines and normalized dependency errors.

## Optional UX Integration (Discovery + Frontend)

For custom file suffixes to appear in the file tree and be selectable in UI:

1. Update directory discovery in `backend/api/dirtree.py`:
   - Include new suffix in `fd` search.
   - Assign a dataset tag for nodes.
2. Update frontend recognition in `frontend/src/utils/datasetPaths.ts`:
   - Add extension(s) and tag(s).

If you only load by explicit path/API calls, this step is optional.

## Error Handling Guidelines

- Raise `DatasetResolutionError` for bad/corrupt input.
- Raise `MissingBackendDependencyError` for optional library/engine missing.
- Raise `UnsupportedDatasetFormatError` only when your provider intentionally does not support a reference.

This keeps API responses deterministic for frontend and tests.
