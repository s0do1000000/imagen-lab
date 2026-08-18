export interface CreditPackage {
  id: string;
  credits: number;
  stars: number; // Telegram Stars price (integer, no decimals)
  usdtAmount: number; // USDT price (stablecoin, ~$1 each — prices below are already USD-equivalent)
  label: string;
}

// Adjust freely — these are starting numbers, not fixed. Stars ≈ $0.013
// each after Telegram's cut, so price accordingly if you want a specific
// margin over your Google Cloud spend per generation.
export const PACKAGES: CreditPackage[] = [
  { id: "p10", credits: 10, stars: 50, usdtAmount: 0.5, label: "10 генераций" },
  { id: "p50", credits: 50, stars: 200, usdtAmount: 2, label: "50 генераций" },
  { id: "p150", credits: 150, stars: 500, usdtAmount: 5, label: "150 генераций" },
];

// Video costs meaningfully more in Google Cloud credits than an image or a
// photo edit — charging more credits for it keeps the packages fair.
export const VIDEO_CREDIT_COST = 3;
export const IMAGE_CREDIT_COST = 1;
