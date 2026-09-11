"""
The dataset loaders

"""

from pathlib import Path

import numpy as np
import pytest
import xarray as xr

from api import data_loader
from api.data_loader import DatasetResolutionError

QCODES_DB = (
    Path(__file__).resolve().parents[2]
    / "data"
    / "test"
    / "qcodes"
    / "DC_measurement_Jade_tsweep_NbTiN_10_11_2025.db"
)

pytestmark = pytest.mark.skipif(
    not QCODES_DB.exists(), reason="sample QCoDeS database not present"
)


class TestQcodesLoading:
    def test_reads_a_run_into_xarray(self):
        dataset = data_loader._load_qcodes_xarray_dataset(QCODES_DB, 8)

        assert isinstance(dataset, xr.Dataset)
        # The loader stamps how it found the run, which the Basket displays.
        assert dataset.attrs["run_id"] == 8
        assert dataset.attrs["qcodes_db_path"] == str(QCODES_DB)
        assert len(dataset.data_vars) > 0
        dataset.close()

    def test_finds_the_latest_run_when_none_is_named(self):
        latest = data_loader._get_latest_qcodes_run_id(QCODES_DB)

        runs = data_loader.list_qcodes_runs(QCODES_DB)
        assert latest == max(run["run_id"] for run in runs)

    def test_lists_every_run_for_the_tree(self):
        runs = data_loader.list_qcodes_runs(QCODES_DB)

        assert len(runs) > 1
        assert all("run_id" in run for run in runs)

    def test_a_missing_run_fails_with_the_reference_in_the_message(self):
        with pytest.raises(DatasetResolutionError, match="run_id=9999"):
            data_loader._load_qcodes_xarray_dataset(QCODES_DB, 9999)

    def test_loading_through_the_public_entry_point(self):
        loaded = data_loader.load_data_sync(f"{QCODES_DB}#run_id=8")

        assert loaded.kind == "dataset"
        assert loaded.loaded_from == "disk"
        loaded.obj.close()

    def test_an_unnamed_run_resolves_to_the_latest(self):
        latest = data_loader._get_latest_qcodes_run_id(QCODES_DB)

        loaded = data_loader.load_data_sync(str(QCODES_DB))

        assert loaded.obj.attrs["run_id"] == latest
        loaded.obj.close()


class TestFlatTableLoading:
    def test_exposes_every_column_as_a_coordinate(self, tmp_path):
        csv = tmp_path / "sweep.csv"
        csv.write_text("gate,signal\n0,1.5\n1,2.5\n2,3.5\n", encoding="utf-8")

        dataset = data_loader._load_flat_table_dataset(csv)

        # A flat table has no coord/var split, so every column is both -- the
        # attrs below are what tell the rest of the app that.
        assert dataset.attrs["qimchi_tabular"] is True
        assert dataset.attrs["qimchi_all_columns"] == ["gate", "signal"]
        assert dataset.attrs["qimchi_tabular_row_dim"] == "row"
        assert np.allclose(dataset.coords["signal"].values, [1.5, 2.5, 3.5])
        assert dataset.sizes["row"] == 3

    def test_rejects_a_file_with_no_columns(self, tmp_path):
        empty = tmp_path / "empty.csv"
        empty.write_text("", encoding="utf-8")

        with pytest.raises(DatasetResolutionError):
            data_loader._load_flat_table_dataset(empty)

    def test_reports_an_unreadable_table_rather_than_raising_raw(self, tmp_path):
        # polars is lenient about odd bytes, so the case that matters is a
        # file that cannot be read at all -- the error must arrive as the
        # loader's own type, not a raw polars exception.
        with pytest.raises(DatasetResolutionError, match="Failed to read flat table"):
            data_loader._load_flat_table_dataset(tmp_path / "not-here.csv")

    def test_loading_a_csv_through_the_public_entry_point(self, tmp_path):
        csv = tmp_path / "sweep.csv"
        csv.write_text("gate,signal\n0,1.5\n1,2.5\n", encoding="utf-8")

        loaded = data_loader.load_data_sync(str(csv))

        assert loaded.kind == "dataset"
        assert loaded.obj.attrs["qimchi_tabular"] is True
        loaded.obj.close()
