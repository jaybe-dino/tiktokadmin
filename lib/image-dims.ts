// 이미지 가로·세로 읽기 — 헤더만 보고 판독하는 순수 함수(외부 의존 없음).
//   업로드 규격(최소 해상도)을 서버에서 실제로 확인하기 위한 것이다.
//   디코딩하지 않는다 — 앞부분 몇 바이트만 읽으므로 큰 파일도 비용이 거의 없다.

export interface ImageDims { width: number; height: number }

/** PNG: 8바이트 서명 뒤 IHDR 청크의 width·height(각 4바이트 빅엔디언). */
function pngDims(b: Uint8Array): ImageDims | null {
  // 서명 + 길이(4) + "IHDR"(4) + width(4) + height(4) = 최소 24바이트
  if (b.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((v, i) => b[i] === v)) return null;
  if (String.fromCharCode(b[12], b[13], b[14], b[15]) !== "IHDR") return null;
  const be32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  return { width: be32(16), height: be32(20) };
}

/**
 * JPEG: SOI(FFD8) 뒤 세그먼트를 따라가며 SOFn 에서 크기를 읽는다.
 *   · SOF0/1/2/3/5/6/7/9/10/11/13/14/15 가 크기를 담는 프레임 헤더다.
 *   · FFC4(DHT)·FFC8(JPG)·FFCC(DAC) 는 SOF 가 아니므로 건너뛴다.
 *   · FFD8/FFD9/FF01/FFD0~FFD7 은 길이 없는 마커라 2바이트만 넘긴다.
 */
function jpegDims(b: Uint8Array): ImageDims | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) { i += 1; continue; }     // 패딩(FF 연속) 건너뛰기
    const marker = b[i + 1];
    if (marker === 0xff) { i += 1; continue; }
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 ||
        (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }

    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) return null;                    // 손상된 세그먼트
    const isSof = marker >= 0xc0 && marker <= 0xcf &&
      marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      // SOF 본문: precision(1) · height(2) · width(2)
      if (i + 9 >= b.length) return null;
      const height = (b[i + 5] << 8) | b[i + 6];
      const width = (b[i + 7] << 8) | b[i + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    i += 2 + len;
  }
  return null;
}

/**
 * 가로·세로를 읽는다. PNG·JPEG 만 판독하고, 그 밖(PDF 등)은 null 이다.
 *   null 은 "이미지가 아니거나 읽지 못했다"는 뜻이지 "규격 위반"이 아니다 —
 *   호출자가 그 구분을 직접 해야 한다.
 */
export function imageDimensions(bytes: Uint8Array): ImageDims | null {
  return pngDims(bytes) ?? jpegDims(bytes);
}

/**
 * 최소 해상도 확인. 판독 가능한 이미지일 때만 판정한다.
 *   · ok      — 규격을 만족하거나, 이미지가 아니라 검사 대상이 아님
 *   · tooSmall — 판독했고 기준보다 작다
 */
export function checkMinPixels(bytes: Uint8Array, minPx: number):
  { ok: true; dims: ImageDims | null } | { ok: false; dims: ImageDims } {
  const dims = imageDimensions(bytes);
  if (!dims) return { ok: true, dims: null };
  if (dims.width < minPx || dims.height < minPx) return { ok: false, dims };
  return { ok: true, dims };
}
