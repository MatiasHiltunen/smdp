import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import {
  decodeBase64Markdown,
  decodeBase64MarkdownAsText,
  decodeSharePayload,
  encodeMarkdownToBase64,
  encodeSharePayload,
} from "../src/data-link";

function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function padBase64Url(value: string): string {
  const padding = (4 - (value.length % 4)) % 4;
  return value + "=".repeat(padding);
}

class IdentityCompressionStream {
  public readonly readable: ReadableStream<Uint8Array>;
  public readonly writable: WritableStream<Uint8Array>;

  constructor() {
    // Create a passthrough pair so writes immediately surface on the readable
    // side. The real CompressionStream would transform the payload but for the
    // purposes of these tests we simply want to capture the bytes that flow
    // through the piping logic.
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
    this.readable = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
      },
    });

    this.writable = new WritableStream<Uint8Array | ArrayBuffer>({
      write(chunk) {
        if (!controllerRef) {
          throw new Error("Compression stream is not initialized");
        }
        const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
        controllerRef.enqueue(new Uint8Array(bytes));
      },
      close() {
        controllerRef?.close();
      },
      abort(reason) {
        controllerRef?.error(reason);
      },
    });
  }
}

async function withCompressionSupport<T>(fn: () => Promise<T>): Promise<T> {
  const hadCompressionStream = "CompressionStream" in globalThis;
  const hadDecompressionStream = "DecompressionStream" in globalThis;
  const previousCompressionStream = (globalThis as any).CompressionStream;
  const previousDecompressionStream = (globalThis as any).DecompressionStream;
  const hadBtoa = "btoa" in globalThis;
  const hadAtob = "atob" in globalThis;
  const previousBtoa = (globalThis as any).btoa;
  const previousAtob = (globalThis as any).atob;

  (globalThis as any).CompressionStream = IdentityCompressionStream;
  (globalThis as any).DecompressionStream = IdentityCompressionStream;

  if (!hadBtoa) {
    (globalThis as any).btoa = (data: string) => Buffer.from(data, "binary").toString("base64");
  }

  if (!hadAtob) {
    (globalThis as any).atob = (data: string) => Buffer.from(data, "base64").toString("binary");
  }

  try {
    return await fn();
  } finally {
    if (hadCompressionStream) {
      (globalThis as any).CompressionStream = previousCompressionStream;
    } else {
      delete (globalThis as any).CompressionStream;
    }

    if (hadDecompressionStream) {
      (globalThis as any).DecompressionStream = previousDecompressionStream;
    } else {
      delete (globalThis as any).DecompressionStream;
    }

    if (hadBtoa) {
      (globalThis as any).btoa = previousBtoa;
    } else {
      delete (globalThis as any).btoa;
    }

    if (hadAtob) {
      (globalThis as any).atob = previousAtob;
    } else {
      delete (globalThis as any).atob;
    }
  }
}

async function withoutCompressionSupport<T>(fn: () => Promise<T>): Promise<T> {
  const hadCompressionStream = "CompressionStream" in globalThis;
  const hadDecompressionStream = "DecompressionStream" in globalThis;
  const previousCompressionStream = (globalThis as any).CompressionStream;
  const previousDecompressionStream = (globalThis as any).DecompressionStream;
  const hadBtoa = "btoa" in globalThis;
  const hadAtob = "atob" in globalThis;
  const previousBtoa = (globalThis as any).btoa;
  const previousAtob = (globalThis as any).atob;

  if (hadCompressionStream) {
    delete (globalThis as any).CompressionStream;
  }
  if (hadDecompressionStream) {
    delete (globalThis as any).DecompressionStream;
  }

  if (!hadBtoa) {
    (globalThis as any).btoa = (data: string) => Buffer.from(data, "binary").toString("base64");
  }
  if (!hadAtob) {
    (globalThis as any).atob = (data: string) => Buffer.from(data, "base64").toString("binary");
  }

  try {
    return await fn();
  } finally {
    if (hadCompressionStream) {
      (globalThis as any).CompressionStream = previousCompressionStream;
    }
    if (hadDecompressionStream) {
      (globalThis as any).DecompressionStream = previousDecompressionStream;
    }
    if (hadBtoa) {
      (globalThis as any).btoa = previousBtoa;
    } else {
      delete (globalThis as any).btoa;
    }
    if (hadAtob) {
      (globalThis as any).atob = previousAtob;
    } else {
      delete (globalThis as any).atob;
    }
  }
}

const SAMPLE_SHARED_PAYLOAD =
  "H4sIAAAAAAAAA41ZfWxlx1U/G3t3s3cd27vJfiVInCZRY7v2cz5KSL0kZb-SNV13HdubFaRh37x7z3tv4rkzl5m5fvuSTcg_pQWEKqq00CqQigItEVERCAkhCrSqyh8FRIvUCv5AahAVCKFW8Ef5Fjln7nv2JlCxq7Xnfs2cOfM7v_M7ZzfXzq_vA_4z-esA8JEJvrgFABYOAsAiAPwj8OjbAPs-uo-H-z4OcMt3903cAnDLfwJMnJgEgP0AE3cCTNyQ0U8CTHxDRn8NMPn9cAD47cl7ASafmNwnb0--D2DygzL6aYDJr8no6wD7T_Bo_10A-5-FA7LKfgew_8PNKvt_FmD_P8EkwC189c8ABx7n-wfeB3DgC3BAxl8COPjo6J2DZwEO_lp6cvCzALee4tGt3wdw6-sy-i2AQzLHodU3R19urD30FYBD32pWPfQPANl7eJT9EED2CzL6JED27zL6L4DDF5rvDv8IwOGtiQmAwz8GcDg2MxweABx-VUa_AnD4j2T0RYDDfyujbwFM3c6jqeMAU-s81wTA1FMAU-1mhqkewJSf4NEQYOqnZPRzAFOfldHnAKa-vK_57k8Bpr4xw6c19U2A2y7Pzuw7CHCbArjt87Mzt_D4zwCm3zk7M3EQYPoRgOkwy19OvwAw_dHDUzABANMfB5j-1D6A6d8EmP5tvvO7ANO_fxs_nf57gOn_AJj-b4CZfQAztwLMPCSPZh4GmDkPMHMJYOYywMxTADMfSo9-BmDmEwAznwKY-TTAzGtvPv56evRXADN_BzDzbYCZfwGY-TeA2ZY8mn0AYPaHAWafAJhdA5jdApj9CbZ3dgAw-7HpWwW1MYx_wiGA2Vfe_OqPefAF_seDL775xXd58K8ARy4cAjjyOP_jwRMAR2oe7AAc-XAmM2bPqh0Vcq-r-LYrXuHIKwBH_oAHnwc48hc8-CrA0YlDAEcnAY6e4MFJgKNneXAO4Oj5jK0--n6Ao1cOAhx9CuD2X-Rbt_8ywO2_cRDg9tcA7nidb93xOwB3_Dkf4h1fBTh29CDAsRMAx969r0HEsUcAjq2OcH7s_QDHrvHVJF91AY49DwfkL3_5AsCxP-Rpj30J4NjX-NZfAhy_n28dfxjg-KWDAMfXAI6_egTg-KcBjv8qwPHPAJyY5HdOZAAn5g4CnJgHODnDUD95B8DJextjTt4HcHJHRkOAk38jo28CnHqoCYxTjwCcWm3C_9QawKm-jAzAqZ-X0ccATv2JjL4CcOckHBC-ufNWgDtfZ_ze-TmAu-4DuGvuHtxcO7-OKuLT_RirsLK8XBYPtlR8Zu7m6_ksO4NdFeIidoaRlpzXZCMVuKb8duEGFiujhj3valtg7KuInmxBPuDFrbVLeE3Z4hqeU3ZHBQy6IOwM5XcLt_o6YKV6hKGvq4ADHfsY-4RGd7zyQ1S2wMLVHUMBVUCFRu9o28PQd4NcBULXxQGvyB9VygfymNfek41miKGuKudjaGXZY3iVMHqSV3XAgkrXzKg6aF2kjnPbLbxwvaI84sD5bV6HrquyMhQW0bu610cqenyhZKOELs9V0M4qg1uXz19u4WZfV5V8qLwZYknKBhwQKhMcBiIc9MnTXmtD1MZgh2yRzFxY2Iwq1mFhYUVei84ZnlAHrNmpqPKodwgL2iHjqpJsZD8SVnXH6BzPrK8mr1Fl3JAfY-kKMjjgdfK-sj3CDnWdJ1QWtdVRK4O2KtGTIfZpVL5HfL5d59GoSD75bEjKp7V6Thm2yLqI0WHuyooipeOjEFXH6NDfC5B0npoCdmr5pFTbtPt4R4daGR1U1M6iqirvVN5XHcMO04awVNpGpS17QmHl2Qm5MthRRtmcNxQHRBYr8l3nS7nHXmgQwHshFWtP7OR77sEzMXrdqWW5d-K6d8_yqV_SdjtkS7jWrEYFapsOuiIrkdLTsV93Wrkrl9dU1Cpc1CbWluxyKItqN3K-93vz2RKu2lBpTwVHA3s2MJZ3I0r5wJv1FEj5vC-7UVhQ0Iwfh4VDQyGgpx5dX8SSz5Ojk-0_5-x4eww_k7uS3njp5S67UodQM4YD2QLXN8IiOs8nvS1L0PWKvGbYiJ-ucmxJlF6J2ug4xPOOAl4lY3BuyxVqOJ890MJ1xnLYtV5bVMj2G-KpB8oXWKkQFtE67Kh8O3qVc4C1sgdbeLmOVR0D5oaU3csZubINlfCOGwZhUFb6OpklPmw-tsrTjqZBaGUPtfBsbQthC0ZJr1RR5xiGNqrr2Ne9vtG9PgNaoFp5YuhqQwX2vCpL5UMre3cK44aNhHIkYkvCTq1NQX6ZCh2dx-Bw6GoxMw5IbfOEgWxMMNY2RMU8lCC35Ye4GvFHXe0DmS46i4lesyVcVyEyYIejKB578srGJVTdFIKEfRfiCrZvpufl0WVDVi3ne8vBlXStLK7xkbfKop0hLjEFBubAUibzVLpIWLi85vNeTIyEOrJp_ELXDBPVeeoadnRdFSomJuZ9sxdaMvHFra31TbY1CHNih0I8jWyDmBywY1y-jecub2wuMjgGfZ33UQhcFqKY9xNBdZU2suaAsKuYGVW-zafP73XkbAsMaZ_ZEm4ONH-6i44EF44cOb23uiqXt9o45_z_8ez_5c35tO1mTeZXZsOepBfGZzCc5grKtwNHV6I3fPLMotCfp5LKDnl2dfSqoICBSmUZqoL-McQD7_F8Ynrek3G5Mmb4XtyoLbaFs2vLqaAtPhOWkm2tLC_LuwKYH3jgBx9a7sfStNmY9tgJvAy7NaiSmsAnm4tfrxJW3pU6CNdsE1UJMrWNuhwdBHY98Q_HeNK-WKqUj0NM6o5TJgVOpmx45fWOyoeS-aMa8q1EqczRZLpLuRsxbspyvNra6hZe0jnZIDZtkFGS-gzTtHyqS9VjPHpG88DrGHnOnuLQS1tztc_3Yjw4bC-rECiGZeN6rlXZXrtJwpXTNoYR2JrwcF73JAmoKFimlPlHAcqGbbkeE90oBxWq4VLhGryyuitrSufscqgtwyAKRSS14wasW5y35E_LnbzvdC6gCtFxkmhOfk9K3tFBxyadXRVVcZXu84SbspfVsvKOpVI2hqkTmkVLVISUL1SeUwi6k5hddbvOF5w6A85Z5X2TjS0LgbxmUzj652XLkpuV0T0rEoMNdUYXizikKCpJorvh0IKoMkO0lNynRM4ln0u878ooJsslkRhjskayPW0Zj9RlTTkgY5Y4yVOBuSvoNDKL75AfJiiWyjRPg9VVRTGwdc72nLCC89tCHMKDIqwse0WHPalPmdNoWASNgROwVMPG5FDpbcKSSucban-y1vk2brna8-U9uGoNW_w4K5Eo-L_Q6MhsCRcWzjpTIJVVXwUdFhYkvAL2SRXa9gJWtc374odrq1FxNoh0PV7D4LqRLLOvLkiY4cUXN6PX2xT7ok5ffBFzVYnKEW6Wd9pajFliV7VF9toQvdB46awLlco5KwyNZOMlPFNHl7JmCjPhc0Zdh6OscKzEAhp2wc382Up731JhGy_pEHmvT19_BjdSAmdiu_lOgmVzb53RWtDbUnVC8NP4DD6urTL6uVEKY68y8Y483nV4lpNMyFZWVlDbrstEt_AIOXZcHbFmSEomkXxE19mhDPJGJ7Y4Q9_E5Jbq6JXByIJAKCedLW9nSfiPmYtFOK-byeID5VmoZlfT71FSElXEvN9ieq0l92mhm65RvQZQ2HcxVC5K3qhtUN09MjmXs6tzPtnxauS989kF_hmkLsK64qU8FS2G4KiGWeTaw749T3IESo1S6Sql45JC4JqMSWXPQqEWusg202_sKGs5IHMy1GFEicRLbO8q8nG41FGBA55CDC1845UPpskSTIQErjI9nBnRSJbdwHOqUg0hjf_cwFQT4Q18v2Pk3shurCz9L39Gd1dGgxvZDdxMOpSNG8vqG2xNM_fZYSQMFVdqIrI9WRVSzmPY5CrJaOMGrexGStC73mvm2J3tQqljQAq5qqjAUvntulrEvrNO3g-U1543V1BX1YZP8sbNZ0L-bXNeYdjuaB9ZRYTcOyMloZxnAz9GbVTG8HRbolUbjTp24Xde_cxrjYmFFg5OKBFwS3kQ_bCpTA3FSKMk1aFm62_lzMbMT37i27_3keZi3bvo4rAi7Hhl8z4vUXnX8xRCQxDnWC1d3BPfOLc1rGhTVMN81m63Y8h0yeGIz-Paeakt_CLWj-ALieHv5hLq7tNZJvEwKqQfRUuD8ftzz8vhDTbU4GIszQqLyUD4wvzp5qtyFFSPYvsevEjGjDTkB-wHbKIoKrjmu_d5nvi8ijQ334pudfMys67tzc2_0B4bwfIKH0U1UHpkUUt-zdWPzI3Wmm9Wd4ZaxvXm-KP507zljH_stsay5eVU2OG7MFJZccZHoyMxFTGHN6t6wkdxuevcu5Z7442FHu-pVCyMc1fbuIL3Pt-YXKioWoZsL_bFet3FOU8tjtC5MvTm5_H5DHFkI3Pn3N2XnNsOe4qngimrDnfPn85eSLZLQPeJoZFtSeHgVJJ9NyOJJV9o-jvjmirhtIUXJIUnZBVe70gN1xYsn01lV7spqXLhMq4gkuijgOc2N3FHeZ1YpWlvDF3tkYYUUtNiFHEiF1mkJTU-quACRWznzji_FHJedSUJuCStU31HYmN022RbeJZyVTcVzO7alWi5jov9RBX88aj3lbLsYrPx1IsRWTUUl-uQEkkKk_TNGqe43SpnV7zH1E8a6_dxkujU3a5AV9vouMXjut2Qe1am6VsxqWNYLBejGvdmchmlwabnV0dOD9vWDUZW5cpy62e300bXKxfo5jJG0lxluDhu-j39YcfrYiRESQVNUkQ35nlS0jUsnDSWSh3CbnYVp4iuWMQna8kC78Tz1JUGlrMhewzfeOmVMzd3UDjpBrR8bFg4S6e55Hq2DrHpN3aJD4tbd6H1xku_lD0ms7wscGGSwUiqXGyOfUC0nXEdwsjr1MZQRCNCR2prdmSjcHWkku_y_TNSPwdtuGfKaSbnKMm2yJcre-xPM42UQi1JirFecOtkvKexYBmR6YWyQ0VBBa5yJZS94-l170TTc_DpikSrFFpxdyORZ2VUTn3H8YSB_I7OabdrVek81GWr6rvowvJ7Hr5_-d2P3P_ejqn9ow_OpxUfdy7axv0brMi5ZAzZVUoZUx61nv7xB55hJw65itK2wDqkCop2yGJf2aJUxagFyvFqqatjMrBbP_ecaNGMZ1nhlPI2MSFlbyoUpQrmm-0Wl0FSUA1TWcGR3aOICnOvy8CpTCTLqOy6stp4cUMNUrDOndeBw7jAs0M-HOaL-Wy1K1NZF7kmkxej6qXu51gJLMoG72PByYCVaqaF7b1JqL1LQRzKkpHa4_q6iQpWfC3uEgkpkU2JOuKOVtj-nhku-poTXHuX1lQIdUlShzO9NLJKGhSKYcd-vinCcMOpolQVblpVhb7j3tR3Xn35dS5amMj9rvjm_nQ1zva7TKDtKPW3x-8uSeaKzod2S2Z87VVcWLiqbeEG3NCzUXo93OrhabXdoRB1L-WQduKcjZGjublJ1-OD51v84ftINDanhjGF5jqVR6J4FhbWOBeM2ns8_0bNtLY-jH1nF3HzyUuSEbQ9jRt1Zyiyt3D5qELlehkrxx3t5KPd7qrt4ZauAndAzxlnqekbVC4h-QkdL9YdaXGO-zWSwYxp86tvaeFI-_JKoD2QlrPqcbBafNdbZXXe5_6S9CsvSy8F1ze4QZx73UnyUCUY7JDXXc3lwKYQLR8s15umkv9x2JLmgQ6ozEANm9ZAdNhXviC7snvki1gqJjmXGpypN9hJuCh0t8uLjpogb819Cd1BcgL39ynXrGlYDDsmByZOLu77DqVLXVBU0pdN7epWlm31FdejXaloKtPI6bKo3oEXder2JIfLCQQWFUPUKXT7aodQF6TCGy-97HzqPcn_ruyVymyu5KlEDqIfQiv7H3-LOfreHwAA";
test("encodes and decodes markdown round-trip", { concurrency: false }, async () => {
  await withCompressionSupport(async () => {
    const markdown = "# Heading\n- item 1\n- item 2";
    const base64 = await encodeMarkdownToBase64(markdown);

    assert.ok(!base64.includes("+"));
    assert.ok(!base64.includes("/"));

    const decodedBytes = await decodeBase64Markdown(base64);
    assert.equal(new TextDecoder().decode(decodedBytes), markdown);

    const decodedText = await decodeBase64MarkdownAsText(base64);
    assert.equal(decodedText, markdown);
  });
});

test("prefers native Uint8Array base64 helpers when available", { concurrency: false }, async () => {
  await withCompressionSupport(async () => {
    const originalToBase64 = (Uint8Array.prototype as any).toBase64;
    const originalFromBase64 = (Uint8Array as any).fromBase64;

    const toBase64Options: Array<{ alphabet?: string }> = [];
    const fromBase64Options: Array<{ alphabet?: string }> = [];

    try {
      (Uint8Array.prototype as any).toBase64 = function toBase64(options?: { alphabet?: string }) {
        toBase64Options.push({ ...options });
        return toBase64Url(Buffer.from(this as Uint8Array));
      };

      (Uint8Array as any).fromBase64 = function fromBase64(value: string, options?: { alphabet?: string }) {
        fromBase64Options.push(options ? { ...options } : {});
        const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
        const padded = padBase64Url(normalized);
        return new Uint8Array(Buffer.from(padded, "base64"));
      };

      const markdown = "Native helpers exercise";
      const base64 = await encodeMarkdownToBase64(markdown);
      assert.equal(toBase64Options.length, 1);
      assert.equal(toBase64Options[0]?.alphabet, "base64url");

      const decoded = await decodeBase64MarkdownAsText(base64);
      assert.equal(fromBase64Options.length, 1);
      assert.equal(fromBase64Options[0]?.alphabet, "base64url");
      assert.equal(decoded, markdown);
    } finally {
      if (originalToBase64) {
        (Uint8Array.prototype as any).toBase64 = originalToBase64;
      } else {
        delete (Uint8Array.prototype as any).toBase64;
      }

      if (originalFromBase64) {
        (Uint8Array as any).fromBase64 = originalFromBase64;
      } else {
        delete (Uint8Array as any).fromBase64;
      }
    }
  });
});

test("falls back to manual base64 helpers when Uint8Array extensions are missing", { concurrency: false }, async () => {
  await withCompressionSupport(async () => {
    const originalToBase64 = (Uint8Array.prototype as any).toBase64;
    const originalFromBase64 = (Uint8Array as any).fromBase64;

    try {
      delete (Uint8Array.prototype as any).toBase64;
      delete (Uint8Array as any).fromBase64;
      (Uint8Array as any).fromBase64 = undefined;

      const markdown = "Fallback helper coverage";
      const base64 = await encodeMarkdownToBase64(markdown);

      // The fallback uses the URL alphabet and trims padding, same as the
      // native helpers. Double-check we didn't regress that behaviour.
      assert.ok(!base64.includes("+"));
      assert.ok(!base64.includes("/"));
      assert.ok(!base64.endsWith("="));

      const decoded = await decodeBase64MarkdownAsText(base64);
      assert.equal(decoded, markdown);
    } finally {
      if (originalToBase64) {
        (Uint8Array.prototype as any).toBase64 = originalToBase64;
      }
      if (originalFromBase64) {
        (Uint8Array as any).fromBase64 = originalFromBase64;
      }
    }
  });
});

test("decodes gzip payload when Compression Streams API is unavailable", { concurrency: false }, async () => {
  await withoutCompressionSupport(async () => {
    const decoded = await decodeSharePayload(SAMPLE_SHARED_PAYLOAD);
    assert.equal(decoded.format, "structured");
    const markdown = new TextDecoder().decode(decoded.markdown);
    assert.ok(markdown.startsWith("# SMDP"));
    assert.ok(decoded.blocks instanceof Uint8Array);
  });
});

test("encodes share payload when Compression Streams API is unavailable", { concurrency: false }, async () => {
  await withoutCompressionSupport(async () => {
    const markdown = "# Offline compression\n\nContent";
    const encoded = await encodeSharePayload({ markdown });
    assert.ok(encoded.length > 0);
    const roundTrip = await decodeSharePayload(encoded);
    assert.equal(new TextDecoder().decode(roundTrip.markdown), markdown);
  });
});

test("encodes markdown with embedded theme payloads", { concurrency: false }, async () => {
  await withCompressionSupport(async () => {
    const payload = {
      markdown: "# Title\nSome content",
      themes: {
        dark: "dark-theme-serialized",
        light: "light-theme-serialized",
      },
    };

    const encoded = await encodeSharePayload(payload);
    const decoded = await decodeSharePayload(encoded);

    const decodedMarkdown = new TextDecoder().decode(decoded.markdown);
    assert.equal(decodedMarkdown, payload.markdown);
    assert.equal(decoded.themes.dark, payload.themes?.dark);
    assert.equal(decoded.themes.light, payload.themes?.light);
    assert.equal(decoded.format, "structured");
    assert.ok(decoded.blocks && decoded.blocks.length > 0);
  });
});

test("supports base79 encoding for backward compatibility", { concurrency: false }, async () => {
  await withCompressionSupport(async () => {
    const payload = {
      markdown: "Base79 payload",
    };

    const encoded = await encodeSharePayload(payload, undefined, { encoding: "base79" });
    const decoded = await decodeSharePayload(encoded, undefined, { encoding: "base79" });

    const decodedMarkdown = new TextDecoder().decode(decoded.markdown);
    assert.equal(decodedMarkdown, payload.markdown);
    assert.equal(decoded.format, "structured");
    assert.ok(decoded.blocks && decoded.blocks.length > 0);
  });
});

test("decodes legacy payloads without embedded header", { concurrency: false }, async () => {
  await withCompressionSupport(async () => {
    const markdown = "legacy payload content";
    const legacyBase64 = toBase64Url(Buffer.from(markdown, "utf8"));

    const decoded = await decodeSharePayload(legacyBase64, undefined, { encoding: "base64" });
    const decodedMarkdown = new TextDecoder().decode(decoded.markdown);

    assert.equal(decodedMarkdown, markdown);
    assert.deepEqual(decoded.themes, {});
    assert.equal(decoded.format, "legacy");
  });
});
