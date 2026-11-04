//! Small, fast, seedable random number generation.
//!
//! The engine must be deterministic for a given seed (snapshots, reproducible
//! experiments, tests), cheap enough to call once per neuron per step, and free of
//! platform dependencies. xoshiro128++ meets all three.

/// SplitMix64, used only to expand a seed into generator state.
#[derive(Clone)]
pub struct SplitMix64(u64);

impl SplitMix64 {
    pub fn new(seed: u64) -> Self {
        SplitMix64(seed)
    }
    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
}

/// xoshiro128++ (Blackman & Vigna).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Rng {
    s: [u32; 4],
}

impl Rng {
    /// Seeds from a 64-bit value and a stream id, so independent streams (topology,
    /// dynamics, sampling) never share a sequence.
    pub fn new(seed: u64, stream: u64) -> Rng {
        let mut sm = SplitMix64::new(seed ^ stream.wrapping_mul(0xD1B5_4A32_D192_ED03));
        let a = sm.next_u64();
        let b = sm.next_u64();
        let mut s = [a as u32, (a >> 32) as u32, b as u32, (b >> 32) as u32];
        if s == [0; 4] {
            s[0] = 1;
        }
        Rng { s }
    }

    pub fn state(&self) -> [u32; 4] {
        self.s
    }

    pub fn from_state(s: [u32; 4]) -> Rng {
        Rng { s }
    }

    #[inline(always)]
    pub fn next_u32(&mut self) -> u32 {
        let s = &mut self.s;
        let result = s[0].wrapping_add(s[3]).rotate_left(7).wrapping_add(s[0]);
        let t = s[1] << 9;
        s[2] ^= s[0];
        s[3] ^= s[1];
        s[1] ^= s[2];
        s[0] ^= s[3];
        s[2] ^= t;
        s[3] = s[3].rotate_left(11);
        result
    }

    /// Uniform in [0, 1).
    #[inline(always)]
    pub fn next_f32(&mut self) -> f32 {
        (self.next_u32() >> 8) as f32 * (1.0 / 16_777_216.0)
    }

    /// Uniform integer in [0, n). Lemire's multiply-shift; the bias is below 2^-32·n,
    /// negligible for network construction.
    #[inline(always)]
    pub fn below(&mut self, n: u32) -> u32 {
        ((self.next_u32() as u64 * n as u64) >> 32) as u32
    }

    /// Standard normal via Box–Muller (accurate; used at build time).
    pub fn gaussian(&mut self) -> f32 {
        let u1 = (self.next_u32() as f64 + 1.0) / 4_294_967_297.0;
        let u2 = self.next_u32() as f64 / 4_294_967_296.0;
        ((-2.0 * u1.ln()).sqrt() * (std::f64::consts::TAU * u2).cos()) as f32
    }
}

/// Number of entries in the fast normal table (a power of two).
pub const NORMAL_TABLE_BITS: u32 = 12;
pub const NORMAL_TABLE_SIZE: usize = 1 << NORMAL_TABLE_BITS;

/// Inverse-CDF table of the standard normal at bin midpoints, rescaled to unit
/// variance. Indexing it with the top bits of a random u32 gives a normal deviate
/// for the cost of one load, which matters in the per-neuron noise loop. The tails
/// are truncated at about ±3.5σ, which is fine for background noise.
pub fn normal_table() -> Vec<f32> {
    let n = NORMAL_TABLE_SIZE;
    let mut t: Vec<f64> = (0..n)
        .map(|i| inverse_normal_cdf((i as f64 + 0.5) / n as f64))
        .collect();
    let var = t.iter().map(|x| x * x).sum::<f64>() / n as f64;
    let k = 1.0 / var.sqrt();
    for x in t.iter_mut() {
        *x *= k;
    }
    t.into_iter().map(|x| x as f32).collect()
}

/// Acklam's rational approximation of the inverse normal CDF (|error| < 1.2e-9).
fn inverse_normal_cdf(p: f64) -> f64 {
    const A: [f64; 6] = [
        -3.969_683_028_665_376e1,
        2.209_460_984_245_205e2,
        -2.759_285_104_469_687e2,
        1.383_577_518_672_69e2,
        -3.066_479_806_614_716e1,
        2.506_628_277_459_239,
    ];
    const B: [f64; 5] = [
        -5.447_609_879_822_406e1,
        1.615_858_368_580_409e2,
        -1.556_989_798_598_866e2,
        6.680_131_188_771_972e1,
        -1.328_068_155_288_572e1,
    ];
    const C: [f64; 6] = [
        -7.784_894_002_430_293e-3,
        -3.223_964_580_411_365e-1,
        -2.400_758_277_161_838,
        -2.549_732_539_343_734,
        4.374_664_141_464_968,
        2.938_163_982_698_783,
    ];
    const D: [f64; 4] = [
        7.784_695_709_041_462e-3,
        3.224_671_290_700_398e-1,
        2.445_134_137_142_996,
        3.754_408_661_907_416,
    ];
    let plow = 0.02425;
    if p < plow {
        let q = (-2.0 * p.ln()).sqrt();
        (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5])
            / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1.0)
    } else if p <= 1.0 - plow {
        let q = p - 0.5;
        let r = q * q;
        (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q
            / (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1.0)
    } else {
        -inverse_normal_cdf(1.0 - p)
    }
}

/// FxHash-style 64-bit mixing hash. Used to fingerprint a network's topology so a
/// snapshot can only be restored onto the network it was taken from.
#[derive(Clone, Copy)]
pub struct Fingerprint(u64);

impl Default for Fingerprint {
    fn default() -> Self {
        Fingerprint(0xCBF2_9CE4_8422_2325)
    }
}

impl Fingerprint {
    #[inline(always)]
    pub fn add(&mut self, word: u32) {
        self.0 = (self.0.rotate_left(5) ^ word as u64).wrapping_mul(0x5170_9A7E_0F2D_4D5B);
    }
    pub fn finish(self) -> u64 {
        let mut z = self.0;
        z = (z ^ (z >> 33)).wrapping_mul(0xFF51_AFD7_ED55_8CCD);
        z ^ (z >> 33)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_and_stream_separated() {
        let mut a = Rng::new(42, 0);
        let mut b = Rng::new(42, 0);
        let mut c = Rng::new(42, 1);
        let xs: Vec<u32> = (0..16).map(|_| a.next_u32()).collect();
        let ys: Vec<u32> = (0..16).map(|_| b.next_u32()).collect();
        let zs: Vec<u32> = (0..16).map(|_| c.next_u32()).collect();
        assert_eq!(xs, ys);
        assert_ne!(xs, zs);
    }

    #[test]
    fn below_is_in_range_and_covers() {
        let mut r = Rng::new(7, 0);
        let mut seen = [false; 10];
        for _ in 0..10_000 {
            let x = r.below(10);
            assert!(x < 10);
            seen[x as usize] = true;
        }
        assert!(seen.iter().all(|&s| s));
    }

    #[test]
    fn normal_table_has_unit_variance_and_zero_mean() {
        let t = normal_table();
        let n = t.len() as f64;
        let mean = t.iter().map(|&x| x as f64).sum::<f64>() / n;
        let var = t.iter().map(|&x| (x as f64 - mean).powi(2)).sum::<f64>() / n;
        assert!(mean.abs() < 1e-6, "mean {mean}");
        assert!((var - 1.0).abs() < 1e-3, "var {var}");
    }

    #[test]
    fn gaussian_moments() {
        let mut r = Rng::new(3, 9);
        let n = 200_000;
        let xs: Vec<f64> = (0..n).map(|_| r.gaussian() as f64).collect();
        let mean = xs.iter().sum::<f64>() / n as f64;
        let var = xs.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / n as f64;
        assert!(mean.abs() < 0.01);
        assert!((var - 1.0).abs() < 0.02);
    }
}
