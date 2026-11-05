//! Binary simulation snapshots.
//!
//! A snapshot restores the complete *dynamic* state of a network: time, membrane
//! potentials, synaptic currents, refractory counters, queued events, every
//! synaptic weight, plasticity traces, neuromodulator, region/pathway switches,
//! edited neuron parameters, active stimuli and the noise generator state.
//!
//! It does not contain the topology. A snapshot is restored onto a network rebuilt
//! from the same configuration, and is refused if the topology fingerprint differs.
//! The application stores the configuration alongside (see `src/persistence`).
//!
//! Layout: little-endian, `NFSTATE\x01` magic, then a version number. All arrays
//! are length-prefixed so a truncated or mismatched file fails cleanly.

use crate::network::Network;
use crate::rng::Rng;
use crate::stimulus::StimulusSpec;

pub const MAGIC: &[u8; 8] = b"NFSTATE\x01";
pub const VERSION: u32 = 1;

pub struct Writer {
    pub buf: Vec<u8>,
}

impl Writer {
    pub fn new() -> Writer {
        Writer { buf: Vec::new() }
    }
    pub fn u8(&mut self, v: u8) {
        self.buf.push(v);
    }
    pub fn u32(&mut self, v: u32) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }
    pub fn u64(&mut self, v: u64) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }
    pub fn f32(&mut self, v: f32) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }
    pub fn bytes(&mut self, b: &[u8]) {
        self.u32(b.len() as u32);
        self.buf.extend_from_slice(b);
    }
    pub fn f32_slice(&mut self, s: &[f32]) {
        self.u32(s.len() as u32);
        self.buf.reserve(s.len() * 4);
        for &x in s {
            self.buf.extend_from_slice(&x.to_le_bytes());
        }
    }
    pub fn u32_slice(&mut self, s: &[u32]) {
        self.u32(s.len() as u32);
        self.buf.reserve(s.len() * 4);
        for &x in s {
            self.buf.extend_from_slice(&x.to_le_bytes());
        }
    }
    pub fn u16_slice(&mut self, s: &[u16]) {
        self.u32(s.len() as u32);
        for &x in s {
            self.buf.extend_from_slice(&x.to_le_bytes());
        }
    }
    pub fn u64_slice(&mut self, s: &[u64]) {
        self.u32(s.len() as u32);
        for &x in s {
            self.buf.extend_from_slice(&x.to_le_bytes());
        }
    }
}

impl Default for Writer {
    fn default() -> Self {
        Writer::new()
    }
}

pub struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    pub fn new(data: &'a [u8]) -> Reader<'a> {
        Reader { data, pos: 0 }
    }
    fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        if self.pos + n > self.data.len() {
            return Err("snapshot is truncated".into());
        }
        let s = &self.data[self.pos..self.pos + n];
        self.pos += n;
        Ok(s)
    }
    pub fn u8(&mut self) -> Result<u8, String> {
        Ok(self.take(1)?[0])
    }
    pub fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    pub fn u64(&mut self) -> Result<u64, String> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }
    pub fn f32(&mut self) -> Result<f32, String> {
        Ok(f32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    pub fn bytes(&mut self) -> Result<&'a [u8], String> {
        let n = self.u32()? as usize;
        self.take(n)
    }
    fn len_matches(&mut self, expected: usize) -> Result<(), String> {
        let n = self.u32()? as usize;
        if n != expected {
            return Err(format!("snapshot array length {n} does not match network ({expected})"));
        }
        Ok(())
    }
    pub fn f32_into(&mut self, out: &mut [f32]) -> Result<(), String> {
        self.len_matches(out.len())?;
        let b = self.take(out.len() * 4)?;
        for (k, x) in out.iter_mut().enumerate() {
            *x = f32::from_le_bytes(b[4 * k..4 * k + 4].try_into().unwrap());
        }
        Ok(())
    }
    pub fn u32_into(&mut self, out: &mut [u32]) -> Result<(), String> {
        self.len_matches(out.len())?;
        let b = self.take(out.len() * 4)?;
        for (k, x) in out.iter_mut().enumerate() {
            *x = u32::from_le_bytes(b[4 * k..4 * k + 4].try_into().unwrap());
        }
        Ok(())
    }
    pub fn u16_into(&mut self, out: &mut [u16]) -> Result<(), String> {
        self.len_matches(out.len())?;
        let b = self.take(out.len() * 2)?;
        for (k, x) in out.iter_mut().enumerate() {
            *x = u16::from_le_bytes(b[2 * k..2 * k + 2].try_into().unwrap());
        }
        Ok(())
    }
    pub fn u64_into(&mut self, out: &mut [u64]) -> Result<(), String> {
        self.len_matches(out.len())?;
        let b = self.take(out.len() * 8)?;
        for (k, x) in out.iter_mut().enumerate() {
            *x = u64::from_le_bytes(b[8 * k..8 * k + 8].try_into().unwrap());
        }
        Ok(())
    }
    pub fn u32_vec(&mut self) -> Result<Vec<u32>, String> {
        let n = self.u32()? as usize;
        let b = self.take(n * 4)?;
        Ok((0..n)
            .map(|k| u32::from_le_bytes(b[4 * k..4 * k + 4].try_into().unwrap()))
            .collect())
    }
}

impl Network {
    /// Serialises the dynamic state (see module docs).
    pub fn snapshot(&self) -> Vec<u8> {
        let mut w = Writer::new();
        w.buf.extend_from_slice(MAGIC);
        w.u32(VERSION);
        w.u32(self.n as u32);
        w.u32(self.target.len() as u32);
        w.u32(self.regions.len() as u32);
        w.u32(self.projections.len() as u32);
        w.u32(self.ring_slots as u32);
        w.u64(self.topology_hash);
        w.f32(self.dt);
        w.u64(self.step);
        for x in self.rng.state() {
            w.u32(x);
        }
        let p = &self.p;
        for arr in [
            &p.v_rest, &p.v_th, &p.v_reset, &p.tau, &p.refractory_ms, &p.resistance,
            &p.excitability, &p.bias, &p.i_ext, &p.noise_std, &p.i_stim,
        ] {
            w.f32_slice(arr);
        }
        w.f32_slice(&self.v);
        w.f32_slice(&self.i_exc);
        w.f32_slice(&self.i_inh);
        w.u16_slice(&self.ref_left);
        w.u32_slice(&self.spike_count);
        w.u32_slice(&self.last_spike);
        w.f32_slice(&self.ring);
        w.u64_slice(&self.slot_events);
        w.f32_slice(&self.weight);
        for r in &self.regions {
            w.u8(r.enabled as u8);
        }
        for pr in &self.projections {
            w.f32(pr.gain);
        }
        self.plasticity.write(&mut w);
        w.u32(self.next_stimulus_id);
        w.u32(self.stimuli.len() as u32);
        for s in &self.stimuli {
            w.u32(s.id);
            w.bytes(serde_json::to_string(&s.spec).unwrap_or_default().as_bytes());
            w.u32_slice(&s.targets);
            w.u64(s.start_step);
            w.u8(s.on as u8);
            w.u64(s.events);
        }
        w.buf
    }

    /// Restores a snapshot taken from a network with the same topology. On error
    /// the network may be partially overwritten; callers should rebuild it.
    pub fn restore(&mut self, data: &[u8]) -> Result<(), String> {
        let mut r = Reader::new(data);
        if r.take(8)? != MAGIC {
            return Err("not a NEUROFORM state snapshot".into());
        }
        let version = r.u32()?;
        if version != VERSION {
            return Err(format!("unsupported snapshot version {version}"));
        }
        let (n, s, rc, pc, slots) = (r.u32()?, r.u32()?, r.u32()?, r.u32()?, r.u32()?);
        let hash = r.u64()?;
        if n as usize != self.n
            || s as usize != self.target.len()
            || rc as usize != self.regions.len()
            || pc as usize != self.projections.len()
            || slots as usize != self.ring_slots
            || hash != self.topology_hash
        {
            return Err("the snapshot was taken from a different network".into());
        }
        let dt = r.f32()?;
        if dt != self.dt {
            return Err("the snapshot uses a different timestep".into());
        }
        // Validate everything into temporaries before touching the network.
        let step = r.u64()?;
        let rng = [r.u32()?, r.u32()?, r.u32()?, r.u32()?];
        let mut p = self.p.clone();
        for arr in [
            &mut p.v_rest, &mut p.v_th, &mut p.v_reset, &mut p.tau, &mut p.refractory_ms,
            &mut p.resistance, &mut p.excitability, &mut p.bias, &mut p.i_ext, &mut p.noise_std,
            &mut p.i_stim,
        ] {
            r.f32_into(arr)?;
        }
        let mut v = vec![0.0; self.n];
        let mut ie = vec![0.0; self.n];
        let mut ii = vec![0.0; self.n];
        let mut rl = vec![0u16; self.n];
        let mut sc = vec![0u32; self.n];
        let mut ls = vec![0u32; self.n];
        r.f32_into(&mut v)?;
        r.f32_into(&mut ie)?;
        r.f32_into(&mut ii)?;
        r.u16_into(&mut rl)?;
        r.u32_into(&mut sc)?;
        r.u32_into(&mut ls)?;
        let mut ring = vec![0.0; self.ring.len()];
        r.f32_into(&mut ring)?;
        let mut se = vec![0u64; self.slot_events.len()];
        r.u64_into(&mut se)?;
        let mut weight = vec![0.0; self.weight.len()];
        r.f32_into(&mut weight)?;
        let mut enabled = Vec::with_capacity(self.regions.len());
        for _ in 0..self.regions.len() {
            enabled.push(r.u8()? != 0);
        }
        let mut gains = Vec::with_capacity(self.projections.len());
        for _ in 0..self.projections.len() {
            gains.push(r.f32()?);
        }
        let mut plast = self.plasticity.clone();
        plast.read(&mut r)?;
        let next_id = r.u32()?;
        let count = r.u32()? as usize;
        let mut stimuli = Vec::with_capacity(count);
        for _ in 0..count {
            let id = r.u32()?;
            let spec: StimulusSpec = serde_json::from_slice(r.bytes()?)
                .map_err(|e| format!("invalid stimulus in snapshot: {e}"))?;
            let targets = r.u32_vec()?;
            let start = r.u64()?;
            let on = r.u8()? != 0;
            let events = r.u64()?;
            if targets.iter().any(|&t| t as usize >= self.n) {
                return Err("snapshot stimulus targets a missing neuron".into());
            }
            stimuli.push((id, spec, targets, start, on, events));
        }

        self.step = step;
        self.rng = Rng::from_state(rng);
        self.p = p;
        for i in 0..self.n {
            self.p.refresh(i, self.dt);
        }
        self.v = v;
        self.i_exc = ie;
        self.i_inh = ii;
        self.ref_left = rl;
        self.spike_count = sc;
        self.last_spike = ls;
        self.ring = ring;
        self.slot_events = se;
        self.weight = weight;
        for (reg, e) in self.regions.iter_mut().zip(enabled) {
            reg.enabled = e;
        }
        for (pr, g) in self.projections.iter_mut().zip(gains) {
            pr.gain = g;
        }
        self.refresh_projection_tables();
        self.plasticity = plast;
        self.stimuli.clear();
        for (id, spec, targets, start, on, events) in stimuli {
            let mut st = crate::stimulus::build(self, spec, start, targets)
                .map_err(|e| format!("invalid stimulus in snapshot: {e}"))?;
            st.id = id;
            st.on = on;
            st.events = events;
            self.stimuli.push(st);
        }
        self.next_stimulus_id = next_id;
        self.fired.clear();
        self.frame_spikes.clear();
        self.raster.clear();
        self.probe_buf.clear();
        self.tw.clear(self.step);
        Ok(())
    }
}
