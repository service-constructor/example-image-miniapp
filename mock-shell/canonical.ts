// Canonical JSON matching Go's encoding/json byte-for-byte, so the consent this
// mock shell signs verifies on the platform. Same rules as the service's
// encoder: explicit field order, "sig":"" included, sorted map keys, HTML
// escaping of < > &.

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

function encodeString(s: string): string {
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    switch (ch) {
      case '"': out += '\\"'; break;
      case "\\": out += "\\\\"; break;
      case "\n": out += "\\n"; break;
      case "\r": out += "\\r"; break;
      case "\t": out += "\\t"; break;
      case "<": out += "\\u003c"; break;
      case ">": out += "\\u003e"; break;
      case "&": out += "\\u0026"; break;
      default:
        out += code < 0x20 ? "\\u" + code.toString(16).padStart(4, "0") : ch;
    }
  }
  return out + '"';
}

function encodeValue(v: Json): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return encodeString(v);
  if (Array.isArray(v)) return "[" + v.map(encodeValue).join(",") + "]";
  const keys = Object.keys(v).sort();
  return "{" + keys.map((k) => encodeString(k) + ":" + encodeValue(v[k]!)).join(",") + "}";
}

export interface FieldSpec {
  key: string;
  value: Json | undefined;
  omitempty?: boolean;
}

export function encodeStruct(fields: FieldSpec[]): string {
  const parts: string[] = [];
  for (const f of fields) {
    if (f.omitempty && isEmpty(f.value)) continue;
    parts.push(encodeString(f.key) + ":" + encodeValue(f.value as Json));
  }
  return "{" + parts.join(",") + "}";
}

function isEmpty(v: Json | undefined): boolean {
  if (v === undefined || v === null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}
