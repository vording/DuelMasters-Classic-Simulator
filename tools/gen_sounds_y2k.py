"""Y2K / futuristic placeholder sound effects (synthesized WAV) for the DM app.
Glossy FM bells, detuned supersaws, laser sweeps, bitcrushed glitches and digital echoes.
Usage: py tools/gen_sounds_y2k.py sounds
"""
import math, os, random, struct, sys, wave

SR = 32000
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
random.seed(2000)
TAU = 2 * math.pi


def n_of(dur):
    return int(SR * dur)


def env(i, n, a=0.003, d=1.0, curve=4.0):
    """attack then exponential-ish decay over the whole length"""
    t = i / SR
    att = min(1.0, t / a) if a else 1.0
    x = i / max(1, n - 1)
    return att * (1 - x) ** (curve * d) if d else att


def lerp_exp(a, b, x):
    return a * (b / a) ** x


def fm(f0, f1, dur, ratio=2.0, index=3.0, index_end=None, vol=0.5, a=0.003, curve=4.0, vib=0.0):
    """FM tone: carrier sweeps f0 -> f1 (exponential), modulator = carrier * ratio"""
    n = n_of(dur)
    pc = pm = 0.0
    s = []
    ie = index if index_end is None else index_end
    for i in range(n):
        x = i / n
        f = lerp_exp(f0, f1, x) * (1 + vib * math.sin(TAU * 7 * i / SR))
        pc += TAU * f / SR
        pm += TAU * f * ratio / SR
        idx = index + (ie - index) * x
        s.append(math.sin(pc + idx * math.sin(pm)) * vol * env(i, n, a, 1, curve))
    return s


def supersaw(freq, dur, voices=5, detune=0.012, vol=0.25, a=0.01, curve=2.5, cutoff0=6000, cutoff1=1500):
    """detuned saws through a sweeping one-pole lowpass"""
    n = n_of(dur)
    phases = [random.random() for _ in range(voices)]
    fs = [freq * (1 + detune * (k - (voices - 1) / 2) / ((voices - 1) / 2 or 1)) for k in range(voices)]
    y = 0.0
    s = []
    for i in range(n):
        v = 0.0
        for k in range(voices):
            phases[k] = (phases[k] + fs[k] / SR) % 1.0
            v += phases[k] * 2 - 1
        v /= voices
        cut = lerp_exp(cutoff0, cutoff1, i / n)
        alpha = 1 - math.exp(-TAU * cut / SR)
        y += alpha * (v - y)
        s.append(y * vol * env(i, n, a, 1, curve))
    return s


def square(f0, f1, dur, vol=0.2, a=0.002, curve=3.0, duty=0.5):
    n = n_of(dur)
    p = 0.0
    s = []
    for i in range(n):
        p = (p + lerp_exp(f0, f1, i / n) / SR) % 1.0
        s.append((1.0 if p < duty else -1.0) * vol * env(i, n, a, 1, curve))
    return s


def noise(dur, vol=0.4, cut0=8000, cut1=800, hp=False, a=0.002, curve=3.0):
    """filtered noise sweep (lowpass, or highpass when hp)"""
    n = n_of(dur)
    y = 0.0
    s = []
    for i in range(n):
        w = random.uniform(-1, 1)
        cut = lerp_exp(cut0, cut1, i / n)
        alpha = 1 - math.exp(-TAU * cut / SR)
        y += alpha * (w - y)
        v = (w - y) if hp else y
        s.append(v * vol * env(i, n, a, 1, curve))
    return s


def ring(f, fmod, dur, vol=0.4, curve=6.0):
    n = n_of(dur)
    return [math.sin(TAU * f * i / SR) * math.sin(TAU * fmod * i / SR) * vol * env(i, n, 0.001, 1, curve) for i in range(n)]


def crush(s, bits=6, hold=3):
    q = 2 ** (bits - 1)
    outv = []
    last = 0.0
    for i, v in enumerate(s):
        if i % hold == 0:
            last = round(v * q) / q
        outv.append(last)
    return outv


def echo(s, delay=0.09, fb=0.38, taps=4, tail=True):
    d = n_of(delay)
    outv = s + ([0.0] * d * taps if tail else [])
    for k in range(1, taps + 1):
        g = fb ** k
        for i, v in enumerate(s):
            j = i + d * k
            if j < len(outv):
                outv[j] += v * g
    return outv


def mix(*parts):
    n = max(len(p) for p in parts)
    s = [0.0] * n
    for p in parts:
        for i, v in enumerate(p):
            s[i] += v
    return s


def at(p, sec):
    return [0.0] * n_of(sec) + p


def seq(*parts, gap=0.0):
    s = []
    for p in parts:
        s += p + [0.0] * n_of(gap)
    return s


def bell(f, dur=0.5, vol=0.35, ratio=3.5, index=2.5):
    """glassy FM bell"""
    return fm(f, f, dur, ratio=ratio, index=index, index_end=0.2, vol=vol, curve=3.5)


def sparkle(count=6, start=0.0, spread=0.25, lo=2500, hi=6000, vol=0.12):
    parts = []
    for _ in range(count):
        f = random.uniform(lo, hi)
        parts.append(at(fm(f, f * 1.02, 0.12, ratio=1.41, index=1.5, vol=vol, curve=5), start + random.uniform(0, spread)))
    return mix(*parts)


def arp(freqs, step=0.07, note=0.22, maker=None):
    maker = maker or (lambda f: bell(f, note, 0.3))
    return mix(*[at(maker(f), k * step) for k, f in enumerate(freqs)])


def hz(note):
    """MIDI note -> Hz"""
    return 440.0 * 2 ** ((note - 69) / 12)


C5, D5, E5, F5, G5, A5, B5 = (hz(n) for n in (72, 74, 76, 77, 79, 81, 83))
C6, E6, G6, B6, C7 = (hz(n) for n in (84, 88, 91, 95, 96))

S = {}
# ---- UI ----
S['button'] = echo(fm(2100, 2300, 0.045, ratio=1.5, index=1.2, vol=0.35, curve=6), 0.05, 0.25, 2)
S['open'] = echo(mix(fm(700, 2200, 0.13, ratio=2.01, index=2.0, index_end=0.5, vol=0.35, curve=2.5),
                     sparkle(3, 0.05, 0.08, 3500, 6500, 0.08)), 0.07, 0.3, 3)
S['close'] = echo(fm(2000, 650, 0.12, ratio=2.01, index=1.6, index_end=0.3, vol=0.33, curve=2.5), 0.07, 0.25, 2)
S['cancel'] = crush(seq(square(520, 520, 0.06, 0.2, curve=2), square(330, 300, 0.1, 0.2, curve=2), gap=0.015), 5, 4)
S['card-add'] = echo(seq(bell(E6, 0.07, 0.3, 2.0, 1.5), bell(B6, 0.16, 0.32, 2.0, 1.8)), 0.06, 0.3, 3)
S['card-remove'] = echo(fm(1400, 520, 0.11, ratio=1.0, index=2.0, index_end=0.2, vol=0.3, curve=3), 0.06, 0.22, 2)
S['page'] = echo(mix(noise(0.45, 0.32, 600, 9000, hp=False, a=0.08, curve=1.6),
                     supersaw(hz(55), 0.45, cutoff0=300, cutoff1=5000, vol=0.18, a=0.05, curve=1.8),
                     fm(300, 2600, 0.4, ratio=0.5, index=3, index_end=0.5, vol=0.12, a=0.05, curve=1.5),
                     sparkle(5, 0.25, 0.15, 4000, 7000, 0.07)), 0.11, 0.3, 3)
# ---- cards / zones ----
S['draw'] = mix(noise(0.08, 0.25, 9000, 3000, hp=True, curve=3), at(fm(1800, 2600, 0.06, 1.5, 1.0, vol=0.25, curve=5), 0.03))
S['shuffle'] = crush(seq(*[fm(f, f * 0.9, 0.028, 2.0, 2.0, vol=0.25, curve=4) for f in (random.uniform(900, 3000) for _ in range(9))], gap=0.012), 6, 2)
S['tap'] = mix(ring(1500, 430, 0.05, 0.35, 8), noise(0.02, 0.15, 9000, 4000, hp=True, curve=6))
S['untap'] = fm(900, 1700, 0.07, ratio=1.0, index=1.2, vol=0.28, curve=4)
S['summon'] = echo(mix(arp([C6, E6, G6, C7], 0.05, 0.3),
                       supersaw(C5, 0.45, vol=0.12, a=0.03, cutoff0=1200, cutoff1=4000),
                       sparkle(6, 0.12, 0.3)), 0.09, 0.32, 3)
S['evolve'] = echo(mix(fm(200, 1600, 0.6, ratio=0.5, index=4, index_end=1, vol=0.18, a=0.05, curve=1.2),
                       supersaw(hz(60), 0.7, vol=0.14, a=0.2, cutoff0=400, cutoff1=6000, curve=1.5),
                       at(arp([C6, E6, G6, B6, C7], 0.05, 0.35), 0.35),
                       sparkle(8, 0.4, 0.35)), 0.1, 0.32, 3)
S['spell'] = echo(mix(fm(500, 1800, 0.35, ratio=3.01, index=3.5, index_end=0.5, vol=0.25, curve=2, vib=0.02),
                      at(bell(E6, 0.4, 0.2, 4.0, 2), 0.08), at(bell(B6, 0.35, 0.15, 4.0, 2), 0.14),
                      sparkle(6, 0.05, 0.3)), 0.12, 0.35, 4)
S['trigger'] = echo(mix(seq(*[square(f, f, 0.07, 0.16, curve=1.5, duty=0.3) for f in (1320, 1760, 1320, 1760, 2640)], gap=0.012),
                        sparkle(6, 0.2, 0.25, 3000, 7000, 0.1)), 0.08, 0.3, 3)
S['field'] = echo(mix(bell(G5, 0.3, 0.25, 2.0, 1.5), supersaw(G5 / 2, 0.3, vol=0.08, a=0.02)), 0.08, 0.25, 2)
S['mana-light'] = echo(mix(bell(B6, 0.45, 0.3, 3.5, 2.5), at(bell(E6 * 2, 0.35, 0.12, 3.5, 2), 0.04)), 0.09, 0.3, 3)
S['mana-water'] = echo(mix(fm(880, 1320, 0.35, ratio=1.0, index=1.5, index_end=0.2, vol=0.3, curve=3, vib=0.05),
                           at(fm(1320, 1760, 0.12, 1.0, 1.0, vol=0.15, curve=4), 0.08)), 0.1, 0.32, 3)
S['mana-dark'] = echo(mix(fm(220, 200, 0.5, ratio=1.41, index=3.0, index_end=0.5, vol=0.35, curve=2.5), ring(330, 37, 0.45, 0.12, 3)), 0.12, 0.3, 3)
S['mana-fire'] = echo(mix(bell(E5 * 2, 0.35, 0.28, 2.0, 2.5), crush(noise(0.25, 0.2, 7000, 1500, hp=True, curve=2), 4, 3)), 0.08, 0.25, 2)
S['mana-nature'] = echo(mix(fm(C6, C6, 0.3, ratio=1.0, index=0.8, index_end=0.1, vol=0.3, curve=4), at(fm(G6, G6, 0.2, 1.0, 0.6, vol=0.18, curve=4), 0.05)), 0.09, 0.28, 3)
S['mana-multi'] = echo(mix(bell(C6, 0.45, 0.2), bell(E6, 0.45, 0.2), bell(G6, 0.45, 0.2), sparkle(4, 0.05, 0.2)), 0.09, 0.3, 3)
# ---- battle ----
S['attack'] = echo(mix(fm(2600, 180, 0.28, ratio=0.5, index=5, index_end=1, vol=0.28, curve=1.8),
                       noise(0.25, 0.22, 3000, 400, curve=2)), 0.07, 0.25, 2)
S['attacked'] = crush(echo(seq(square(880, 880, 0.09, 0.18, curve=1.2, duty=0.25), square(660, 660, 0.13, 0.18, curve=1.2, duty=0.25), gap=0.04), 0.1, 0.25, 2), 6, 3)
S['block'] = echo(mix(fm(140, 90, 0.3, ratio=1.41, index=4, index_end=0.5, vol=0.45, curve=2.2), ring(1200, 310, 0.15, 0.18, 5)), 0.08, 0.22, 2)
S['break'] = echo(mix(crush(noise(0.4, 0.4, 12000, 2500, hp=True, curve=2.2), 5, 2),
                      *[at(bell(random.uniform(2500, 6500), random.uniform(0.15, 0.35), 0.12, random.choice([2.76, 3.5, 5.4]), 2), random.uniform(0, 0.12)) for _ in range(10)]),
                  0.06, 0.3, 3)
S['destroy'] = echo(crush(mix(fm(1400, 60, 0.4, ratio=0.51, index=6, index_end=1, vol=0.3, curve=1.5), noise(0.35, 0.25, 4000, 200, curve=1.8)), 5, 3), 0.08, 0.22, 2)
S['discard'] = mix(noise(0.14, 0.28, 6000, 700, curve=2.2), fm(1200, 500, 0.1, 1.0, 1.0, vol=0.12, curve=3))
# ---- turn / phase / result ----
S['phase'] = echo(seq(fm(1500, 1500, 0.045, 2.0, 1.0, vol=0.28, curve=4), fm(2000, 2000, 0.07, 2.0, 1.0, vol=0.28, curve=4), gap=0.01), 0.06, 0.25, 2)
S['myturn'] = echo(mix(arp([G5, C6, E6, G6], 0.08, 0.3, lambda f: mix(bell(f, 0.3, 0.22), supersaw(f / 2, 0.25, vol=0.08, a=0.01))),
                       sparkle(5, 0.25, 0.25)), 0.1, 0.32, 3)
S['endturn'] = echo(seq(bell(G6, 0.1, 0.28, 2.0, 1.5), bell(C6, 0.22, 0.28, 2.0, 1.5), gap=0.01), 0.09, 0.28, 3)
S['win'] = echo(mix(arp([C6, E6, G6, C7, E6 * 2], 0.1, 0.45, lambda f: mix(bell(f, 0.45, 0.2), supersaw(f / 2, 0.4, vol=0.08, a=0.02))),
                    at(supersaw(C5, 0.9, vol=0.12, a=0.1, cutoff0=1500, cutoff1=6000, curve=1.5), 0.45),
                    sparkle(12, 0.4, 0.6)), 0.12, 0.35, 4)
S['lose'] = crush(echo(arp([G5, hz(78), hz(75), hz(72)], 0.18, 0.45, lambda f: fm(f, f * 0.97, 0.45, 1.0, 2.0, 0.3, vol=0.28, curve=2.5)), 0.14, 0.3, 3), 7, 2)


# ピークをそろえる（よく鳴る小さな操作音は控えめに）
LEVEL = {'button': 0.55, 'tap': 0.6, 'untap': 0.6, 'draw': 0.6, 'phase': 0.65, 'card-add': 0.7, 'card-remove': 0.65,
         'open': 0.65, 'close': 0.6, 'cancel': 0.45, 'discard': 0.7, 'shuffle': 0.7, 'attacked': 0.55, 'trigger': 0.7}


def write(name, samples):
    peak = max(1e-9, max(abs(v) for v in samples))
    k = LEVEL.get(name, 0.85) / peak
    n = len(samples)
    fade = min(n, n_of(0.01))
    with wave.open(os.path.join(out, f'{name}.wav'), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = bytearray()
        for i, v in enumerate(samples):
            g = (n - i) / fade if i > n - fade else 1.0
            frames += struct.pack('<h', int(max(-1.0, min(1.0, v * k * g)) * 32767))
        w.writeframes(bytes(frames))


for name, samples in S.items():
    write(name, samples)
print(len(S))
