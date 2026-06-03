const NORMAL_MAD_SCALE = 1.4826;

export function median(nums) {
  if (!Array.isArray(nums) || nums.length === 0) throw new Error('median: empty');
  const sorted = [...nums].map(Number).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function mad(nums, options = {}) {
  const scale = options.scale ?? 'raw';
  const center = median(nums);
  const raw = median(nums.map((num) => Math.abs(Number(num) - center)));
  return raw * (scale === 'normal' ? NORMAL_MAD_SCALE : 1);
}
