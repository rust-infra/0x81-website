//! Minimal Go `encoding/gob` codec for the struct written by
//! `plugins.RedisShardCache` when `ValueWithTTL` is enabled:
//!
//! ```go
//! type cacheValue struct {
//!     ExpireTs int64
//!     Value    []byte
//! }
//! ```
//!
//! The encoder emits the same type descriptor Go emits for the first value on
//! a stream, then one value message. This keeps Redis values readable by both
//! the Go and the Rust implementation.

use crate::error::{CacheError, Result};

const TYPE_DEF: &[u8] = b"\x2e\x7f\x03\x01\x01\x0acacheValue\x01\xff\x80\x00\x01\x02\x01\x08ExpireTs\x01\x04\x00\x01\x05Value\x01\x0a\x00\x00\x00";

pub fn encode(expire_ts: i64, value: &[u8]) -> Vec<u8> {
    let mut payload = vec![0xff, 0x80];
    if expire_ts != 0 {
        payload.push(0x01);
        encode_int(&mut payload, expire_ts);
    }
    if !value.is_empty() {
        let field_delta = if expire_ts != 0 { 1 } else { 2 };
        payload.push(field_delta);
        encode_uint(&mut payload, value.len() as u64);
        payload.extend_from_slice(value);
    }
    payload.push(0x00);

    let mut out = Vec::with_capacity(TYPE_DEF.len() + payload.len() + 2);
    out.extend_from_slice(TYPE_DEF);
    encode_uint(&mut out, payload.len() as u64);
    out.extend_from_slice(&payload);
    out
}

pub fn decode(data: &[u8]) -> Result<(i64, Vec<u8>)> {
    let mut cursor = if data.starts_with(TYPE_DEF) {
        TYPE_DEF.len()
    } else {
        return Err(CacheError::Message(
            "gob: unexpected cacheValue type descriptor".to_string(),
        ));
    };

    let message_len = decode_uint(data, &mut cursor)? as usize;
    let message_end = cursor
        .checked_add(message_len)
        .filter(|end| *end <= data.len())
        .ok_or_else(|| CacheError::Message("gob: truncated message".to_string()))?;

    let _type_id = decode_uint(data, &mut cursor)?;
    let mut expire_ts = 0i64;
    let mut value = Vec::new();
    let mut field_num: i64 = -1;

    loop {
        if cursor > message_end {
            return Err(CacheError::Message(
                "gob: field past message end".to_string(),
            ));
        }
        let delta = decode_uint(data, &mut cursor)? as i64;
        if delta == 0 {
            break;
        }
        field_num += delta;
        match field_num {
            0 => expire_ts = decode_int(data, &mut cursor)?,
            1 => {
                let len = decode_uint(data, &mut cursor)? as usize;
                let end = cursor
                    .checked_add(len)
                    .filter(|end| *end <= message_end)
                    .ok_or_else(|| CacheError::Message("gob: truncated bytes".to_string()))?;
                value.extend_from_slice(&data[cursor..end]);
                cursor = end;
            }
            other => {
                return Err(CacheError::Message(format!(
                    "gob: unexpected field {other}"
                )));
            }
        }
    }

    if cursor > message_end {
        return Err(CacheError::Message(
            "gob: field past message end".to_string(),
        ));
    }
    Ok((expire_ts, value))
}

fn encode_uint(out: &mut Vec<u8>, value: u64) {
    if value <= 0x7f {
        out.push(value as u8);
        return;
    }
    let byte_len = (64 - value.leading_zeros() as usize).div_ceil(8);
    out.push((256 - byte_len) as u8);
    let bytes = value.to_be_bytes();
    out.extend_from_slice(&bytes[8 - byte_len..]);
}

fn encode_int(out: &mut Vec<u8>, value: i64) {
    let encoded = if value < 0 {
        ((!(value as u64)) << 1) | 1
    } else {
        (value as u64) << 1
    };
    encode_uint(out, encoded);
}

fn decode_uint(data: &[u8], cursor: &mut usize) -> Result<u64> {
    let first = *data
        .get(*cursor)
        .ok_or_else(|| CacheError::Message("gob: unexpected end".to_string()))?;
    *cursor += 1;
    if first <= 0x7f {
        return Ok(u64::from(first));
    }
    let byte_len = 256usize - usize::from(first);
    if byte_len == 0 || byte_len > 8 {
        return Err(CacheError::Message("gob: bad uint length".to_string()));
    }
    let end = cursor
        .checked_add(byte_len)
        .filter(|end| *end <= data.len())
        .ok_or_else(|| CacheError::Message("gob: truncated uint".to_string()))?;
    let mut value = 0u64;
    for byte in &data[*cursor..end] {
        value = (value << 8) | u64::from(*byte);
    }
    *cursor = end;
    Ok(value)
}

fn decode_int(data: &[u8], cursor: &mut usize) -> Result<i64> {
    let value = decode_uint(data, cursor)?;
    if value & 1 == 0 {
        Ok((value >> 1) as i64)
    } else {
        Ok(!(value >> 1) as i64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_go_golden_vectors() {
        let cases: &[(i64, &[u8], &str)] = &[
            (
                1700000000,
                b"hello",
                "2e7f0301010a636163686556616c756501ff8000010201084578706972655473010400010556616c7565010a00000010ff8001fccaa7e200010568656c6c6f00",
            ),
            (
                0,
                b"",
                "2e7f0301010a636163686556616c756501ff8000010201084578706972655473010400010556616c7565010a00000003ff8000",
            ),
            (
                0,
                b"x",
                "2e7f0301010a636163686556616c756501ff8000010201084578706972655473010400010556616c7565010a00000006ff8002017800",
            ),
            (
                5,
                b"",
                "2e7f0301010a636163686556616c756501ff8000010201084578706972655473010400010556616c7565010a00000005ff80010a00",
            ),
            (
                127,
                b"a",
                "2e7f0301010a636163686556616c756501ff8000010201084578706972655473010400010556616c7565010a00000009ff8001fffe01016100",
            ),
            (
                128,
                b"a",
                "2e7f0301010a636163686556616c756501ff8000010201084578706972655473010400010556616c7565010a0000000aff8001fe010001016100",
            ),
            (
                -1,
                b"a",
                "2e7f0301010a636163686556616c756501ff8000010201084578706972655473010400010556616c7565010a00000008ff80010101016100",
            ),
            (
                1234567890123,
                &[0, 1, 2, 255],
                "2e7f0301010a636163686556616c756501ff8000010201084578706972655473010400010556616c7565010a00000011ff8001fa023ee3f609960104000102ff00",
            ),
            (
                -5,
                b"x",
                "2e7f0301010a636163686556616c756501ff8000010201084578706972655473010400010556616c7565010a00000008ff80010901017800",
            ),
        ];

        for (expire_ts, value, expected_hex) in cases {
            let encoded = encode(*expire_ts, value);
            let expected: Vec<u8> = (0..expected_hex.len())
                .step_by(2)
                .map(|index| u8::from_str_radix(&expected_hex[index..index + 2], 16).unwrap())
                .collect();
            assert_eq!(encoded, expected, "encoding {expire_ts} {value:?}");
            let (decoded_ts, decoded_value) = decode(&encoded).unwrap();
            assert_eq!(decoded_ts, *expire_ts);
            assert_eq!(decoded_value, *value);
        }
    }
}
