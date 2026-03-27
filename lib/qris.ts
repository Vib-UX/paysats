export interface DecodedQris {
  merchantName: string;
  amountIdr: number;
  payload: string;
}

function parseEmv(payload: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let i = 0;

  while (i + 4 <= payload.length) {
    const id = payload.slice(i, i + 2);
    const len = Number(payload.slice(i + 2, i + 4));
    const valueStart = i + 4;
    const valueEnd = valueStart + len;

    if (Number.isNaN(len) || valueEnd > payload.length) {
      break;
    }

    fields[id] = payload.slice(valueStart, valueEnd);
    i = valueEnd;
  }

  return fields;
}

export function decodeQris(payload: string): DecodedQris {
  const fields = parseEmv(payload);
  const merchantName = fields["59"] || "Unknown Merchant";
  const amountIdr = Number(fields["54"] || 0);

  if (!payload || payload.length < 20) {
    throw new Error("Invalid QRIS payload.");
  }

  return {
    merchantName,
    amountIdr,
    payload
  };
}
