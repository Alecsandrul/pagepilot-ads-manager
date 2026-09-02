import { useState } from "react";
import type * as React from "react";
import Dropdown from "./Dropdown";
import { preset, rangeLabel } from "../lib/dates";
import type { DateRange } from "../lib/types";

interface Props {
  range: DateRange;
  onChange: (r: DateRange) => void;
}

const PRESET_DAYS: (7 | 14 | 30)[] = [7, 14, 30];

export default function DateRangePicker({ range, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);

  function openPicker() {
    setFrom(range.from);
    setTo(range.to);
    setOpen(!open);
  }

  function applyCustom() {
    if (!from || !to || from > to) return;
    onChange({ from, to, label: "Custom" });
    setOpen(false);
  }

  const inputStyle: React.CSSProperties = {
    height: 30,
    padding: "0 8px",
    border: "1px solid #CFD2D7",
    borderRadius: 7,
    fontSize: 12.5,
    color: "#1C2B33",
    width: "100%",
  };

  return (
    <Dropdown
      open={open}
      onClose={() => setOpen(false)}
      width={280}
      trigger={
        <div
          className="btn-secondary"
          onClick={openPicker}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            height: 34,
            padding: "0 12px",
            border: "1px solid #CFD2D7",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            background: "#fff",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#1C2B33" }} />
          <span>{rangeLabel(range)}</span>
          <span style={{ color: "#8A8D91", fontSize: 12 }}>{range.label}</span>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {PRESET_DAYS.map((d) => {
          const r = preset(d);
          const active = range.label === r.label;
          return (
            <div
              key={d}
              className="menu-item"
              onClick={() => {
                onChange(r);
                setOpen(false);
              }}
              style={{
                padding: "8px 10px",
                borderRadius: 7,
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                color: active ? "#0064E0" : "#1C2B33",
                cursor: "pointer",
              }}
            >
              {r.label}
            </div>
          );
        })}
        <div style={{ height: 1, background: "#EBEDF0", margin: "6px 0" }} />
        <div style={{ padding: "2px 10px 8px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#5A5F66" }}>Custom range</div>
          <div style={{ display: "flex", gap: 8 }}>
            <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 11, color: "#8A8D91" }}>From</span>
              <input
                className="search-input"
                type="date"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 11, color: "#8A8D91" }}>To</span>
              <input
                className="search-input"
                type="date"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
                style={inputStyle}
              />
            </label>
          </div>
          <button
            className="btn-primary"
            onClick={applyCustom}
            disabled={!from || !to || from > to}
            style={{
              height: 30,
              border: "none",
              borderRadius: 7,
              background: "#0064E0",
              color: "#fff",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
              opacity: !from || !to || from > to ? 0.5 : 1,
            }}
          >
            Apply
          </button>
        </div>
      </div>
    </Dropdown>
  );
}
