'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import Image from 'next/image';
import { MiniKit } from '@worldcoin/minikit-js';
import { Tokens, tokenToDecimals } from '@worldcoin/minikit-js/commands';
import { playKissSoundEffect } from './kissAudio';
import { WalletVerification } from '@/components/WalletVerification';
import { walletAuth } from '@/auth/wallet';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alpha: number;
  color: string;
  size: number;
  shape?: 'circle' | 'shred' | 'smoke' | 'spark';
  rotation?: number;
  rotationSpeed?: number;
}

interface FloatingText {
  id: number;
  text: string;
  x: number;
  y: number;
  alpha: number;
  color: string;
  isCoin?: boolean;
}

type ItemKind = 'heart' | 'golden' | 'kiss' | 'hazard';

interface FallingItem {
  id: number;
  x: number;
  y: number;
  size: number;
  speed: number;
  wobble: number;
  wobbleSpeed: number;
  wobbleAmount?: number;
  kind: ItemKind;
  rotation: number;
}

const KissBalloonIcon: React.FC<{ className?: string; size?: number }> = ({ className = 'w-28 h-28 mb-3', size = 112 }) => (
  <div className={`relative ${className} rounded-[30px] overflow-hidden shadow-[0_14px_32px_rgba(244,63,94,0.42)] border-2 border-white/90 transition-transform hover:scale-105 select-none shrink-0`}>
    <Image
      src="/kiss-balloon-icon-v2.jpg"
      alt="Balloon Kiss"
      width={size}
      height={size}
      className="w-full h-full object-cover"
      priority
    />
    <div className="absolute inset-0 bg-gradient-to-tr from-rose-500/10 via-transparent to-white/30 pointer-events-none rounded-[30px]" />
  </div>
);

const BalloonKissIcon: React.FC<{ size?: number; className?: string }> = ({ size = 26, className = '' }) => (
  <svg
    width={size}
    height={Math.round(size * 0.77)}
    viewBox="-11 -7 22 15"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={`${className} filter drop-shadow-[0_1px_2px_rgba(225,29,72,0.3)] shrink-0`}
  >
    {/* Upper lip with Cupid's bow */}
    <path
      d="M-10,0 C-6,-5.5 -2,-4.5 0,-2.5 C2,-4.5 6,-5.5 10,0 C6,1.2 2,-1 0,0 C-2,-1 -6,1.2 -10,0 Z"
      fill="#E11D48"
    />
    {/* Lower lip voluptuous curve */}
    <path
      d="M-9,1 C-5,7.5 5,7.5 9,1 C5,2.2 -5,2.2 -9,1 Z"
      fill="#FF2E63"
    />
    {/* Specular gloss highlight */}
    <ellipse cx="-2.5" cy="2.8" rx="1.5" ry="0.9" fill="#FFFFFF" opacity={0.85} />
  </svg>
);

export const KissCoinGame: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Game state
  const [gameState, setGameState] = useState<'idle' | 'playing' | 'paused' | 'gameover'>('idle');
  const [gameOverReason, setGameOverReason] = useState<'miss' | 'burst'>('miss');
  const [heartsCaught, setHeartsCaught] = useState<number>(0);
  const [kissCoins, setKissCoins] = useState<number>(0);
  const [kissesCaught, setKissesCaught] = useState<number>(0);
  const [lives, setLives] = useState<number>(3);
  const [highScore, setHighScore] = useState<number>(0);
  const [streak, setStreak] = useState<number>(0);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [totalKissTokens, setTotalKissTokens] = useState<number>(0);
  const [lastFlightScore, setLastFlightScore] = useState<number>(0);

  // Top scorer banner state
  const [bannerMessage, setBannerMessage] = useState<string>('Kiss the sky! 💋');
  const [bannerAuthor, setBannerAuthor] = useState<string>('Top Pilot');
  const [bannerIsSponsor, setBannerIsSponsor] = useState<boolean>(false);
  const [isNewRecord, setIsNewRecord] = useState<boolean>(false);
  const [newBannerText, setNewBannerText] = useState<string>('');
  const [bannerSaved, setBannerSaved] = useState<boolean>(false);
  const [isBannerShielded, setIsBannerShielded] = useState<boolean>(false);
  const [bannerRemainingSeconds, setBannerRemainingSeconds] = useState<number>(0);
  const [isBannerQueued, setIsBannerQueued] = useState<boolean>(false);

  // 1 WLD Sponsor Banner Override State
  const [showWldModal, setShowWldModal] = useState<boolean>(false);
  const [wldPayState, setWldPayState] = useState<'idle' | 'pending' | 'success' | 'failed'>('idle');
  const [sponsorMessage, setSponsorMessage] = useState<string>('');

  // Internal mutable game loop refs to avoid stale closure state
  const stateRef = useRef({
    gameState: 'idle' as 'idle' | 'playing' | 'paused' | 'gameover',
    gameOverReason: 'miss' as 'miss' | 'burst',
    flightStartTime: 0,
    flightDuration: 0,
    flightTopSpeed: 1.0,
    heartsCaught: 0,
    kissCoins: 0,
    kissesCaught: 0,
    lives: 3,
    streak: 0,
    catcherX: 180,
    catcherTargetX: 180,
    catcherVx: 0,
    catcherY: 400,
    catcherTargetY: 400,
    catcherVy: 0,
    catcherWidth: 72,
    catcherHeight: 26,
    balloonBursted: false,
    screenShake: 0,
    keysPressed: new Set<string>(),
    highScore: 0,
    bannerMessage: 'Kiss the sky! 💋',
    bannerAuthor: 'Top Pilot',
    bannerIsSponsor: false,
    hearts: [] as FallingItem[],
    particles: [] as Particle[],
    floatingTexts: [] as FloatingText[],
    lastSpawn: 0,
    spawnInterval: 1200,
    nextId: 1,
    audioCtx: null as AudioContext | null,
    soundEnabled: true,
    invulnerableUntil: 0,
  });

  stateRef.current.gameState = gameState;
  stateRef.current.gameOverReason = gameOverReason;
  stateRef.current.heartsCaught = heartsCaught;
  stateRef.current.kissCoins = kissCoins;
  stateRef.current.kissesCaught = kissesCaught;
  stateRef.current.lives = lives;
  stateRef.current.streak = streak;
  stateRef.current.highScore = highScore;
  stateRef.current.soundEnabled = soundEnabled;
  stateRef.current.bannerMessage = bannerMessage;
  stateRef.current.bannerAuthor = bannerAuthor;
  stateRef.current.bannerIsSponsor = bannerIsSponsor;

  // Sound generator using Web Audio API
  const playSound = useCallback((type: 'catch' | 'coin' | 'miss' | 'gameover' | 'start' | 'kiss' | 'burst') => {
    if (!stateRef.current.soundEnabled) return;
    try {
      if (!stateRef.current.audioCtx) {
        stateRef.current.audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      }
      const ctx = stateRef.current.audioCtx;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'catch') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.12);
      } else if (type === 'kiss') {
        // 1. Instant authentic human kiss sound ("Smooch! Mwah! 💋")
        playKissSoundEffect(1.0);

        // 2. Sparkling Kiss Coin reward chime immediately following the kiss
        [1046.5, 1318.5, 1567.98, 2093.0].forEach((freq, idx) => {
          const sOsc = ctx.createOscillator();
          const sGain = ctx.createGain();
          sOsc.type = 'triangle';
          const noteStart = now + 0.10 + idx * 0.045;
          sOsc.frequency.setValueAtTime(freq, noteStart);
          sGain.gain.setValueAtTime(0.001, noteStart);
          sGain.gain.linearRampToValueAtTime(0.22, noteStart + 0.01);
          sGain.gain.exponentialRampToValueAtTime(0.001, noteStart + 0.24);
          sOsc.connect(sGain);
          sGain.connect(ctx.destination);
          sOsc.start(noteStart);
          sOsc.stop(noteStart + 0.25);
        });
      } else if (type === 'coin') {
        [587.33, 739.99, 880, 1174.66].forEach((freq, idx) => {
          const cOsc = ctx.createOscillator();
          const cGain = ctx.createGain();
          cOsc.connect(cGain);
          cGain.connect(ctx.destination);
          cOsc.type = 'triangle';
          cOsc.frequency.setValueAtTime(freq, now + idx * 0.06);
          cGain.gain.setValueAtTime(0.22, now + idx * 0.06);
          cGain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.06 + 0.25);
          cOsc.start(now + idx * 0.06);
          cOsc.stop(now + idx * 0.06 + 0.25);
        });
      } else if (type === 'miss') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.linearRampToValueAtTime(110, now + 0.2);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
      } else if (type === 'start') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(660, now + 0.15);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
      } else if (type === 'gameover') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.linearRampToValueAtTime(80, now + 0.4);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
        osc.start(now);
        osc.stop(now + 0.4);
      } else if (type === 'burst') {
        // High-energy balloon pop: sharp snappy noise burst + deep sub-bass thump
        try {
          const bufferSize = Math.floor(ctx.sampleRate * 0.1);
          const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
          const output = noiseBuffer.getChannelData(0);
          for (let i = 0; i < bufferSize; i++) {
            output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.018));
          }
          const whiteNoise = ctx.createBufferSource();
          whiteNoise.buffer = noiseBuffer;

          const filter = ctx.createBiquadFilter();
          filter.type = 'bandpass';
          filter.frequency.setValueAtTime(1500, now);
          filter.Q.setValueAtTime(1.4, now);

          const noiseGain = ctx.createGain();
          noiseGain.gain.setValueAtTime(0.75, now);
          noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);

          whiteNoise.connect(filter);
          filter.connect(noiseGain);
          noiseGain.connect(ctx.destination);
          whiteNoise.start(now);
        } catch {
          // Audio buffer fallback
        }

        // Bass shockwave thump
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(190, now);
        osc.frequency.exponentialRampToValueAtTime(30, now + 0.32);
        gain.gain.setValueAtTime(0.6, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.32);
        osc.start(now);
        osc.stop(now + 0.32);
      }
    } catch {
      // Audio might be blocked until user gesture
    }
  }, []);

  // Load high score, banner state, and $KISS token vault on mount
  useEffect(() => {
    try {
      const savedVault = localStorage.getItem('kiss_token_vault_total');
      if (savedVault) setTotalKissTokens(parseInt(savedVault, 10));
    } catch {
      // ignore
    }

    const loadBannerData = async () => {
      try {
        const res = await fetch('/api/banner');
        if (res.ok) {
          const data = await res.json();
          if (data?.banner) {
            setBannerMessage(data.banner.message);
            setBannerAuthor(data.banner.author);
            setBannerIsSponsor(Boolean(data.banner.isSponsor));
            stateRef.current.bannerMessage = data.banner.message;
            stateRef.current.bannerAuthor = data.banner.author;
            stateRef.current.bannerIsSponsor = Boolean(data.banner.isSponsor);
          }
          if (typeof data?.highScore === 'number') {
            setHighScore(data.highScore);
            stateRef.current.highScore = data.highScore;
          }
          if (typeof data?.isShielded === 'boolean') {
            setIsBannerShielded(data.isShielded);
          }
          if (typeof data?.remainingSeconds === 'number') {
            setBannerRemainingSeconds(data.remainingSeconds);
          }
          return;
        }
      } catch {
        // network fallback to local storage
      }

      try {
        const saved = localStorage.getItem('kiss_coin_high_score');
        if (saved) {
          const parsed = parseInt(saved, 10);
          if (!isNaN(parsed)) {
            setHighScore(parsed);
            stateRef.current.highScore = parsed;
          }
        }

        const savedMsg = localStorage.getItem('kiss_coin_banner_message');
        if (savedMsg) {
          setBannerMessage(savedMsg);
          stateRef.current.bannerMessage = savedMsg;
        }

        const savedAuthor = localStorage.getItem('kiss_coin_banner_author');
        if (savedAuthor) {
          setBannerAuthor(savedAuthor);
          stateRef.current.bannerAuthor = savedAuthor;
        }

        const savedSponsor = localStorage.getItem('kiss_coin_banner_is_sponsor');
        if (savedSponsor === 'true') {
          setBannerIsSponsor(true);
          stateRef.current.bannerIsSponsor = true;
        }
      } catch {
        // ignore
      }
    };

    loadBannerData();
  }, []);

  // 1-Hour VIP Shield local countdown tick
  useEffect(() => {
    const timer = setInterval(() => {
      setBannerRemainingSeconds((prev) => {
        if (prev <= 1) {
          setIsBannerShielded(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Save new Champion banner message when a player achieves a new high score
  const handleSaveBanner = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const msg = newBannerText.trim() || 'Kiss the sky! 💋';
    const author = 'Sky Champion';

    try {
      localStorage.setItem('kiss_coin_high_score', (lastFlightScore || highScore).toString());

      const res = await fetch('/api/banner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'highscore',
          author,
          message: msg,
          score: lastFlightScore || highScore,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data?.queued) {
          setIsBannerQueued(true);
          setBannerSaved(true);
          return;
        }
      }
    } catch {
      // ignore
    }

    setBannerMessage(msg);
    setBannerAuthor(author);
    setBannerIsSponsor(false);
    stateRef.current.bannerMessage = msg;
    stateRef.current.bannerAuthor = author;
    stateRef.current.bannerIsSponsor = false;
    setBannerSaved(true);
    setIsBannerQueued(false);

    try {
      localStorage.setItem('kiss_coin_banner_message', msg);
      localStorage.setItem('kiss_coin_banner_author', author);
      localStorage.setItem('kiss_coin_banner_is_sponsor', 'false');
    } catch {
      // ignore
    }
  };

  // VIP 1 WLD Payment Banner Override (1-Hour Guaranteed Shield for all players worldwide)
  const handlePayWldOverride = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const msg = sponsorMessage.trim() || 'Kiss the sky with 1 WLD! 💎';
    const author = 'VIP Sponsor';

    setWldPayState('pending');

    try {
      let refId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : `${Date.now()}`;
      try {
        const res = await fetch('/api/initiate-payment', { method: 'POST' });
        if (res.ok) {
          const data = await res.json();
          if (data?.id) refId = data.id;
        }
      } catch {
        // Fallback reference id
      }

      // Set only once the backend has confirmed the payment with the Developer Portal.
      let paymentSuccess = false;
      let paidTransactionId: string | null = null;

      if (MiniKit.isInstalled()) {
        const recipient =
          process.env.NEXT_PUBLIC_WLD_RECIPIENT_ADDRESS ||
          '0xc44cf13e1525314c0f5182adabd4830a367598ac';

        const payRes = await MiniKit.pay({
          reference: refId,
          to: recipient,
          tokens: [
            {
              symbol: Tokens.WLD,
              token_amount: tokenToDecimals(1, Tokens.WLD).toString(),
            },
          ],
          description: 'Balloon Kiss VIP Sky Banner Override (1 WLD)',
        });

        const resData = (payRes as unknown as { data?: { transaction_id?: string; transactionId?: string; reference?: string } })?.data;
        const txId = resData?.transaction_id || resData?.transactionId;

        if (txId) {
          try {
            const confirm = await fetch('/api/confirm-payment', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ transaction_id: txId, reference: refId }),
            });
            const confirmData = await confirm.json().catch(() => null);

            if (confirm.ok && confirmData?.verified) {
              paymentSuccess = true;
              paidTransactionId = txId;
            } else {
              // Either still settling or it did not pay. Either way the banner is not ours
              // to hand out yet, so say so rather than showing a banner that will not stick.
              console.warn('[pay] not confirmed', confirmData?.reason ?? confirm.status);
            }
          } catch {
            // Treated as unconfirmed: without a verified payment there is no sponsor banner.
          }
        }
      } else {
        // Outside World App there is no wallet to pay with, so the sponsor banner — which is
        // global and paid — cannot be granted here. It used to self-approve in preview, which
        // meant any browser could take the paid slot for free.
        await new Promise((resolve) => setTimeout(resolve, 400));
        paymentSuccess = false;
      }

      if (paymentSuccess) {
        setWldPayState('success');
        setBannerMessage(msg);
        setBannerAuthor(author);
        setBannerIsSponsor(true);
        setIsBannerShielded(true);
        setBannerRemainingSeconds(3600); // 1 full hour guaranteed shield
        setIsBannerQueued(false);
        stateRef.current.bannerMessage = msg;
        stateRef.current.bannerAuthor = author;
        stateRef.current.bannerIsSponsor = true;

        try {
          localStorage.setItem('kiss_coin_banner_message', msg);
          localStorage.setItem('kiss_coin_banner_author', author);
          localStorage.setItem('kiss_coin_banner_is_sponsor', 'true');

          await fetch('/api/banner', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'sponsor',
              author,
              message: msg,
              transaction_id: paidTransactionId,
              reference: refId,
            }),
          });
        } catch {
          // ignore
        }

        playSound('coin');

        setTimeout(() => {
          setShowWldModal(false);
          setWldPayState('idle');
          setSponsorMessage('');
        }, 1200);
      } else {
        setWldPayState('failed');
        setTimeout(() => setWldPayState('idle'), 2500);
      }
    } catch {
      setWldPayState('failed');
      setTimeout(() => setWldPayState('idle'), 2500);
    }
  };

  // Start game handler
  const startGame = useCallback(() => {
    setHeartsCaught(0);
    setKissCoins(0);
    setKissesCaught(0);
    setLives(3);
    setStreak(0);
    setIsNewRecord(false);
    setBannerSaved(false);
    setIsBannerQueued(false);
    setNewBannerText('');
    setGameOverReason('miss');
    setGameState('playing');

    const s = stateRef.current;
    s.lives = 3;
    s.invulnerableUntil = 0;
    s.heartsCaught = 0;
    s.kissCoins = 0;
    s.streak = 0;
    s.flightStartTime = performance.now();
    s.flightDuration = 0;
    s.flightTopSpeed = 1.0;
    s.gameOverReason = 'miss';
    s.balloonBursted = false;
    s.screenShake = 0;
    s.hearts = [];
    s.kissesCaught = 0;
    s.particles = [];
    s.floatingTexts = [];
    s.lastSpawn = performance.now();
    s.spawnInterval = 880;

    const canvas = canvasRef.current;
    if (canvas && canvas.clientHeight > 0) {
      const midY = Math.round(canvas.clientHeight * 0.52);
      s.catcherY = midY;
      s.catcherTargetY = midY;
      s.catcherX = canvas.clientWidth / 2;
      s.catcherTargetX = canvas.clientWidth / 2;
    }

    playSound('start');
  }, [playSound]);

  // Start game with World ID verification trigger on user gesture
  const handleStartGameWithAuth = useCallback(async () => {
    if (MiniKit.isInstalled()) {
      try {
        await walletAuth();
      } catch (err) {
        console.log('Wallet verification deferred on play:', err);
      }
    }
    startGame();
  }, [startGame]);

  // Main Canvas Render and Game Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.resetTransform();
      ctx.scale(dpr, dpr);
      if (rect.height > 0) {
        const midY = Math.round(rect.height * 0.52);
        stateRef.current.catcherY = midY;
        stateRef.current.catcherTargetY = midY;
        stateRef.current.catcherX = rect.width / 2;
        stateRef.current.catcherTargetX = rect.width / 2;
      }
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const drawHeart = (
      c: CanvasRenderingContext2D,
      x: number,
      y: number,
      size: number,
      color: string,
      isGolden = false,
      wobble = 0
    ) => {
      c.save();
      c.translate(x, y);
      c.rotate(Math.sin(wobble) * 0.18);

      // Heart glow aura
      if (isGolden) {
        c.shadowColor = 'rgba(245, 158, 11, 0.7)';
        c.shadowBlur = 14;
      } else {
        c.shadowColor = 'rgba(239, 68, 68, 0.55)';
        c.shadowBlur = 12;
      }

      // Render the authentic system heart emoji (matches the 3 yellow hearts in the lives HUD)
      c.font = `${Math.floor(size * 1.55)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(isGolden ? '💛' : '❤️', 0, 0);

      c.restore();
    };

    const drawKiss = (
      c: CanvasRenderingContext2D,
      x: number,
      y: number,
      size: number,
      wobble: number
    ) => {
      c.save();
      c.translate(x, y);
      c.rotate(Math.sin(wobble) * 0.28);

      // Kiss glow aura
      c.shadowColor = 'rgba(255, 46, 99, 0.65)';
      c.shadowBlur = 14;

      // Render the vibrant kiss emoji
      c.font = `${Math.floor(size * 1.55)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('💋', 0, 0);

      c.restore();
    };

    const drawHazardDart = (
      c: CanvasRenderingContext2D,
      x: number,
      y: number,
      size: number,
      wobble: number
    ) => {
      c.save();
      c.translate(x, y);
      c.rotate(Math.sin(wobble) * 0.14);

      // Warning hazard aura
      c.shadowColor = 'rgba(239, 68, 68, 0.85)';
      c.shadowBlur = 14;

      // 1. Aerodynamic Swept Tail Fins (Top of dart)
      c.fillStyle = '#DC2626';
      c.beginPath();
      c.moveTo(-9, -18);
      c.lineTo(0, -6);
      c.lineTo(9, -18);
      c.lineTo(5, -12);
      c.lineTo(0, -3);
      c.lineTo(-5, -12);
      c.closePath();
      c.fill();

      c.fillStyle = '#F87171';
      c.beginPath();
      c.moveTo(-7, -16);
      c.lineTo(0, -6);
      c.lineTo(0, -3);
      c.lineTo(-3, -11);
      c.closePath();
      c.fill();

      // 2. Heavy Tungsten Dart Barrel (Middle)
      const bodyGrad = c.createLinearGradient(-3.5, -6, 3.5, 4);
      bodyGrad.addColorStop(0, '#1E293B');
      bodyGrad.addColorStop(0.5, '#475569');
      bodyGrad.addColorStop(1, '#0F172A');
      c.fillStyle = bodyGrad;
      c.beginPath();
      c.roundRect(-4, -6, 8, 12, [1.5]);
      c.fill();

      // Hazard Caution Ring (Vibrant yellow & crimson warning stripes)
      c.fillStyle = '#FBBF24';
      c.fillRect(-4, -3, 8, 2.5);
      c.fillStyle = '#EF4444';
      c.fillRect(-4, 1.5, 8, 2.5);

      // 3. Piercing Side Barbs
      c.fillStyle = '#334155';
      c.beginPath();
      c.moveTo(-3.5, 6);
      c.lineTo(-8, 1.5);
      c.lineTo(-3.5, 3.5);
      c.closePath();
      c.fill();
      c.beginPath();
      c.moveTo(3.5, 6);
      c.lineTo(8, 1.5);
      c.lineTo(3.5, 3.5);
      c.closePath();
      c.fill();

      // 4. Ultra-Sharp Needle Point (Points directly down towards the balloon)
      const needleGrad = c.createLinearGradient(0, 6, 0, 20);
      needleGrad.addColorStop(0, '#94A3B8');
      needleGrad.addColorStop(0.5, '#E2E8F0');
      needleGrad.addColorStop(1, '#FFFFFF');
      c.fillStyle = needleGrad;
      c.beginPath();
      c.moveTo(-3.5, 6);
      c.lineTo(3.5, 6);
      c.lineTo(0, 20);
      c.closePath();
      c.fill();

      // Sharp glint on the needle apex
      c.fillStyle = '#FFFFFF';
      c.beginPath();
      c.arc(0, 19.5, 1.6, 0, Math.PI * 2);
      c.fill();

      c.restore();
    };

    const drawHotAirBalloon = (
      c: CanvasRenderingContext2D,
      x: number,
      y: number,
      w: number,
      h: number,
      currentTime: number,
      author: string,
      message: string,
      vx: number,
      vy: number = 0,
      isSponsor: boolean = false,
      isBursted: boolean = false
    ) => {
      c.save();
      // Atmospheric buoyant bobbing
      const hoverY = isBursted ? 0 : Math.sin(currentTime * 0.003) * 6;
      c.translate(x, y + hoverY);

      // Dynamic tilt based on horizontal velocity and subtle floating breath
      const tilt = Math.max(-0.16, Math.min(0.16, vx * 0.005)) + (isBursted ? 0.08 : Math.sin(currentTime * 0.003) * 0.02);
      c.rotate(tilt);

      // 1. Hot Air Balloon Envelope (Above Basket) - only drawn if NOT bursted!
      const balloonCenterY = -76;
      const balloonRadiusX = 33;
      const balloonRadiusY = 38;

      if (!isBursted) {

      // Drop shadow for the balloon
      c.save();
      c.shadowColor = 'rgba(255, 46, 99, 0.25)';
      c.shadowBlur = 16;

      // Balloon Outline / Base Shape (pear-drop)
      c.beginPath();
      c.moveTo(0, balloonCenterY - balloonRadiusY);
      // Right curve down
      c.bezierCurveTo(
        balloonRadiusX * 1.25, balloonCenterY - balloonRadiusY * 0.7,
        balloonRadiusX * 1.1, balloonCenterY + balloonRadiusY * 0.4,
        14, -38
      );
      // Bottom collar
      c.lineTo(-14, -38);
      // Left curve back up
      c.bezierCurveTo(
        -balloonRadiusX * 1.1, balloonCenterY + balloonRadiusY * 0.4,
        -balloonRadiusX * 1.25, balloonCenterY - balloonRadiusY * 0.7,
        0, balloonCenterY - balloonRadiusY
      );
      c.closePath();

      // Clip balloon to draw stylish vertical candy stripes
      c.save();
      c.clip();

      // Background pink & yellow gradient
      const bgGrad = c.createLinearGradient(-balloonRadiusX, 0, balloonRadiusX, 0);
      bgGrad.addColorStop(0, '#FF2E63');
      bgGrad.addColorStop(0.25, '#FFD54F');
      bgGrad.addColorStop(0.5, '#FFF0F5');
      bgGrad.addColorStop(0.75, '#FFD54F');
      bgGrad.addColorStop(1, '#FF2E63');
      c.fillStyle = bgGrad;
      c.fill();

      // Vertical meridian seam lines running smoothly from top apex to bottom collar (No closed loops!)
      c.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      c.lineWidth = 1.6;
      [-24, -12, 0, 12, 24].forEach((midX) => {
        const bottomX = midX * 0.42;
        c.beginPath();
        c.moveTo(0, balloonCenterY - balloonRadiusY);
        c.bezierCurveTo(
          midX * 1.18, balloonCenterY - balloonRadiusY * 0.45,
          midX * 1.08, balloonCenterY + balloonRadiusY * 0.35,
          bottomX, -38
        );
        c.stroke();
      });

      // Center Balloon Emblem: Crisp vector Kiss Lips (not blurry emoji)
      c.save();
      c.translate(0, balloonCenterY - 2);
      c.shadowColor = 'rgba(225, 29, 72, 0.45)';
      c.shadowBlur = 8;
      // Upper lip
      c.fillStyle = '#E11D48';
      c.beginPath();
      c.moveTo(-10, 0);
      c.bezierCurveTo(-6, -5.5, -2, -4.5, 0, -2.5);
      c.bezierCurveTo(2, -4.5, 6, -5.5, 10, 0);
      c.bezierCurveTo(6, 1.2, 2, -1, 0, 0);
      c.bezierCurveTo(-2, -1, -6, 1.2, -10, 0);
      c.fill();
      // Lower lip
      c.fillStyle = '#FF2E63';
      c.beginPath();
      c.moveTo(-9, 1);
      c.bezierCurveTo(-5, 7.5, 5, 7.5, 9, 1);
      c.bezierCurveTo(5, 2.2, -5, 2.2, -9, 1);
      c.fill();
      // Specular highlight on lip
      c.fillStyle = 'rgba(255, 255, 255, 0.75)';
      c.beginPath();
      c.arc(-2.5, 2.5, 1, 0, Math.PI * 2);
      c.fill();
      c.restore();

      c.restore(); // end clip

      // Balloon Outer Border
      c.strokeStyle = '#FFFFFF';
      c.lineWidth = 2.5;
      c.stroke();
      c.restore(); // end shadow

      // Scalloped skirt at bottom of envelope
      c.fillStyle = '#FF2E63';
      c.beginPath();
      c.roundRect(-15, -40, 30, 5, [2, 2, 4, 4]);
      c.fill();

      // 2. Rigging Suspension Cables
      c.strokeStyle = 'rgba(120, 53, 15, 0.7)';
      c.lineWidth = 1.4;
      [
        [-w / 2 + 8, -h / 2, -12, -35],
        [-w / 6, -h / 2, -5, -35],
        [w / 6, -h / 2, 5, -35],
        [w / 2 - 8, -h / 2, 12, -35],
      ].forEach(([x1, y1, x2, y2]) => {
        c.beginPath();
        c.moveTo(x1, y1);
        c.lineTo(x2, y2);
        c.stroke();
      });
      } else {
        // Bursted balloon: severed smoky cable stubs
        c.strokeStyle = 'rgba(75, 85, 99, 0.8)';
        c.lineWidth = 1.4;
        [
          [-w / 2 + 8, -h / 2, -10, -h / 2 - 12],
          [-w / 6, -h / 2, -4, -h / 2 - 14],
          [w / 6, -h / 2, 4, -h / 2 - 14],
          [w / 2 - 8, -h / 2, 10, -h / 2 - 12],
        ].forEach(([x1, y1, x2, y2]) => {
          c.beginPath();
          c.moveTo(x1, y1);
          c.lineTo(x2, y2);
          c.stroke();
        });
      }

      // 3. Burner & Animated Flame
      c.fillStyle = '#374151';
      c.fillRect(-8, -30, 16, 3);

      if (!isBursted) {
        // Flickering Flame with dynamic climb booster
        const climbBoost = Math.max(0, -vy * 0.045);
        const flameHeight = 7 + Math.sin(currentTime * 0.02) * 2.5 + Math.min(14, climbBoost);
        const flameWidth = 4 + Math.min(3, climbBoost * 0.25);
        const flameGrad = c.createRadialGradient(0, -29, 1, 0, -29 - flameHeight / 2, flameHeight);
        flameGrad.addColorStop(0, '#FFFFFF');
        flameGrad.addColorStop(0.3, '#FBBF24');
        flameGrad.addColorStop(0.8, '#EF4444');
        flameGrad.addColorStop(1, 'transparent');
        c.fillStyle = flameGrad;
        c.beginPath();
        c.ellipse(0, -29 - flameHeight / 2, flameWidth, flameHeight, 0, 0, Math.PI * 2);
        c.fill();
      } else {
        // Smoldering extinguished burner smoke puff
        c.fillStyle = 'rgba(156, 163, 175, 0.6)';
        c.beginPath();
        c.arc(0, -32, 4, 0, Math.PI * 2);
        c.arc(-2, -36, 5, 0, Math.PI * 2);
        c.fill();
      }

      // 4. Pilot in the Basket!
      c.save();
      c.translate(0, -h / 2 - 2);
      // Head
      c.fillStyle = '#FFDFC4';
      c.beginPath();
      c.arc(0, -5, 8.5, 0, Math.PI * 2);
      c.fill();
      // Aviator goggles
      c.fillStyle = '#78350F';
      c.beginPath();
      c.roundRect(-7.5, -9.5, 15, 5.5, 2.5);
      c.fill();
      c.fillStyle = '#60A5FA';
      c.beginPath();
      c.arc(-3.5, -6.8, 2.2, 0, Math.PI * 2);
      c.arc(3.5, -6.8, 2.2, 0, Math.PI * 2);
      c.fill();

      if (isBursted) {
        // Wide shocked eyes
        c.fillStyle = '#FFFFFF';
        c.beginPath();
        c.arc(-3, -2.5, 2.5, 0, Math.PI * 2);
        c.arc(3, -2.5, 2.5, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#1E293B';
        c.beginPath();
        c.arc(-3, -2.5, 1.2, 0, Math.PI * 2);
        c.arc(3, -2.5, 1.2, 0, Math.PI * 2);
        c.fill();
        // Surprised open mouth 'O'
        c.fillStyle = '#78350F';
        c.beginPath();
        c.arc(0, 1.5, 2, 0, Math.PI * 2);
        c.fill();
      } else {
        // Cheerful Eyes & Smile
        c.strokeStyle = '#78350F';
        c.lineWidth = 1.2;
        c.beginPath();
        c.arc(0, -2.5, 2.5, 0.2, Math.PI - 0.2);
        c.stroke();
      }
      // Pilot hands resting on basket rim
      c.fillStyle = '#FFDFC4';
      c.beginPath();
      c.arc(-14, 3, 3, 0, Math.PI * 2);
      c.arc(14, 3, 3, 0, Math.PI * 2);
      c.fill();
      c.restore();

      // 5. Wicker Basket (Catcher Catch Zone)
      c.save();
      c.shadowColor = 'rgba(0, 0, 0, 0.15)';
      c.shadowBlur = 8;
      c.shadowOffsetY = 3;

      const basketGrad = c.createLinearGradient(0, -h / 2, 0, h / 2);
      basketGrad.addColorStop(0, '#D97706');
      basketGrad.addColorStop(0.5, '#B45309');
      basketGrad.addColorStop(1, '#92400E');

      c.fillStyle = basketGrad;
      c.beginPath();
      c.roundRect(-w / 2, -h / 2, w, h, [4, 4, 10, 10]);
      c.fill();

      // Basket weave pattern
      c.strokeStyle = 'rgba(251, 191, 36, 0.45)';
      c.lineWidth = 1.2;
      for (let bx = -w / 2 + 7; bx < w / 2; bx += 7) {
        c.beginPath();
        c.moveTo(bx, -h / 2);
        c.lineTo(bx, h / 2);
        c.stroke();
      }
      for (let by = -h / 2 + 5; by < h / 2; by += 5) {
        c.beginPath();
        c.moveTo(-w / 2, by);
        c.lineTo(w / 2, by);
        c.stroke();
      }

      // Basket top leather rim
      c.fillStyle = '#78350F';
      c.beginPath();
      c.roundRect(-w / 2 - 1.5, -h / 2 - 2, w + 3, 4.5, [2]);
      c.fill();

      c.restore();

      // 6. Fluttering Sky Banner (Shows only the message on the balloon!)
      const prefix = isSponsor ? '💎' : '👑';
      const bannerText = `${prefix} "${message}"`;
      c.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      const textMetrics = c.measureText(bannerText);
      const bannerW = Math.min(240, Math.max(120, textMetrics.width + 18));
      const bannerH = 22;

      // Decide trailing direction based on horizontal position in viewport
      const trailRight = x < 185;
      const bannerStartX = trailRight ? 28 : -28;
      const bannerEndX = trailRight ? bannerStartX + bannerW : bannerStartX - bannerW;
      const bannerY = balloonCenterY - 10;

      // Tow lines from balloon to banner
      c.strokeStyle = isSponsor ? 'rgba(217, 119, 6, 0.9)' : 'rgba(180, 83, 9, 0.7)';
      c.lineWidth = 1.3;
      c.beginPath();
      c.moveTo(trailRight ? 22 : -22, balloonCenterY - 6);
      c.lineTo(bannerStartX, bannerY - 3);
      c.moveTo(trailRight ? 20 : -20, balloonCenterY + 6);
      c.lineTo(bannerStartX, bannerY + 11);
      c.stroke();

      // Fluttering cloth ribbon
      c.save();
      c.shadowColor = isSponsor ? 'rgba(245, 158, 11, 0.35)' : 'rgba(0, 0, 0, 0.12)';
      c.shadowBlur = isSponsor ? 10 : 6;
      c.shadowOffsetY = 2;

      // Sinusoidal flutter wave
      const wave = Math.sin(currentTime * 0.005) * 2.5;
      const leftX = Math.min(bannerStartX, bannerEndX);
      const rightX = Math.max(bannerStartX, bannerEndX);

      // Ribbon background (Golden luxury for 1 WLD VIP Sponsor, Cream cloth for regular)
      if (isSponsor) {
        const ribbonGrad = c.createLinearGradient(leftX, bannerY, rightX, bannerY + bannerH);
        ribbonGrad.addColorStop(0, '#FEF3C7');
        ribbonGrad.addColorStop(0.5, '#FDE68A');
        ribbonGrad.addColorStop(1, '#FEF3C7');
        c.fillStyle = ribbonGrad;
      } else {
        c.fillStyle = '#FFFDF5';
      }

      c.beginPath();
      c.moveTo(leftX, bannerY + wave);
      c.lineTo(rightX, bannerY - wave);
      if (trailRight) {
        c.lineTo(rightX - 7, bannerY + bannerH / 2 - wave);
        c.lineTo(rightX, bannerY + bannerH - wave);
      } else {
        c.lineTo(rightX, bannerY + bannerH - wave);
      }
      c.lineTo(leftX, bannerY + bannerH + wave);
      if (!trailRight) {
        c.lineTo(leftX + 7, bannerY + bannerH / 2 + wave);
      }
      c.closePath();
      c.fill();

      // Ribbon Gold Border
      c.strokeStyle = isSponsor ? '#D97706' : '#F59E0B';
      c.lineWidth = isSponsor ? 1.8 : 1.4;
      c.stroke();

      // Banner text (with smooth marquee scroll if message is long!)
      c.save();
      c.beginPath();
      c.rect(leftX + (trailRight ? 4 : 8), bannerY - 4, bannerW - 12, bannerH + 8);
      c.clip();

      c.fillStyle = isSponsor ? '#78350F' : '#9D174D';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const textCenterX = (leftX + rightX) / 2 + (trailRight ? -3 : 3);
      const maxTextW = bannerW - 16;
      if (textMetrics.width > maxTextW) {
        const overflow = textMetrics.width - maxTextW;
        const scrollPhase = (Math.sin(currentTime * 0.0018) * 0.5 + 0.5);
        const scrollX = textCenterX - (scrollPhase - 0.5) * overflow;
        c.fillText(bannerText, scrollX, bannerY + bannerH / 2);
      } else {
        c.fillText(bannerText, textCenterX, bannerY + bannerH / 2);
      }
      c.restore();

      c.restore();

      c.restore(); // end balloon root transform
    };

    let lastTime = performance.now();

    const loop = (currentTime: number) => {
      animId = requestAnimationFrame(loop);

      const dt = Math.min((currentTime - lastTime) / 1000, 0.1);
      lastTime = currentTime;

      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;

      ctx.clearRect(0, 0, width, height);

      const s = stateRef.current;

      ctx.save();
      if (s.screenShake > 0) {
        const shakeMag = s.screenShake;
        const sx = (Math.random() * 2 - 1) * shakeMag;
        const sy = (Math.random() * 2 - 1) * shakeMag;
        ctx.translate(sx, sy);
        s.screenShake = Math.max(0, s.screenShake - dt * 45);
      }

      ctx.save();
      // True Pitch-Black OLED Dark Canvas (#000000) with deep neon nebula horizon
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);

      const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
      bgGrad.addColorStop(0, '#000000');
      bgGrad.addColorStop(0.55, '#030107');
      bgGrad.addColorStop(0.82, '#120419');
      bgGrad.addColorStop(1, '#220619');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      // Sparkling Twinkling Stars across pitch-black OLED night sky
      const starTime = Date.now() * 0.002;
      const stars = [
        { x: width * 0.08, y: height * 0.06, r: 1.6, phase: 0 },
        { x: width * 0.22, y: height * 0.16, r: 1.2, phase: 1.2 },
        { x: width * 0.38, y: height * 0.08, r: 2.0, phase: 2.5 },
        { x: width * 0.54, y: height * 0.04, r: 1.4, phase: 3.1 },
        { x: width * 0.72, y: height * 0.12, r: 1.8, phase: 0.8 },
        { x: width * 0.88, y: height * 0.07, r: 1.3, phase: 4.2 },
        { x: width * 0.15, y: height * 0.25, r: 1.6, phase: 1.9 },
        { x: width * 0.48, y: height * 0.20, r: 1.4, phase: 2.8 },
        { x: width * 0.82, y: height * 0.24, r: 2.2, phase: 3.7 },
        { x: width * 0.30, y: height * 0.35, r: 1.5, phase: 0.5 },
        { x: width * 0.68, y: height * 0.32, r: 1.7, phase: 2.1 },
        { x: width * 0.92, y: height * 0.38, r: 1.3, phase: 4.8 },
      ];

      for (const star of stars) {
        const twinkle = 0.35 + 0.65 * Math.sin(starTime + star.phase);
        ctx.fillStyle = `rgba(255, 255, 255, ${twinkle})`;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
        if (twinkle > 0.75) {
          ctx.fillStyle = `rgba(244, 114, 182, ${twinkle * 0.4})`;
          ctx.beginPath();
          ctx.arc(star.x, star.y, star.r * 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Soft drifting cosmic stardust / nebula clouds
      const cloudTime = Date.now() * 0.0008;
      const nebulae = [
        { x: ((cloudTime * 10 + 40) % (width + 160)) - 80, y: 70, r: 40, alpha: 0.08, color: '244, 63, 94' },
        { x: ((cloudTime * 7 + 190) % (width + 180)) - 90, y: 150, r: 46, alpha: 0.06, color: '168, 85, 247' },
        { x: ((cloudTime * 12 + 310) % (width + 150)) - 75, y: 220, r: 36, alpha: 0.07, color: '236, 72, 153' },
      ];

      for (const neb of nebulae) {
        const grad = ctx.createRadialGradient(neb.x, neb.y, 0, neb.x, neb.y, neb.r);
        grad.addColorStop(0, `rgba(${neb.color}, ${neb.alpha})`);
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(neb.x, neb.y, neb.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Keyboard input support
      const keySpeed = 360; // px/s
      if (s.keysPressed.has('arrowleft') || s.keysPressed.has('keya') || s.keysPressed.has('a')) {
        s.catcherTargetX -= keySpeed * dt;
      }
      if (s.keysPressed.has('arrowright') || s.keysPressed.has('keyd') || s.keysPressed.has('d')) {
        s.catcherTargetX += keySpeed * dt;
      }
      if (s.keysPressed.has('arrowup') || s.keysPressed.has('keyw') || s.keysPressed.has('w')) {
        s.catcherTargetY -= keySpeed * dt;
      }
      if (s.keysPressed.has('arrowdown') || s.keysPressed.has('keys') || s.keysPressed.has('s')) {
        s.catcherTargetY += keySpeed * dt;
      }

      const halfW = s.catcherWidth / 2;
      const minX = halfW + 6;
      const maxX = width - halfW - 6;
      const minY = 95; // envelope dome reaches near top
      const maxY = height - 26; // basket sits near bottom

      s.catcherTargetX = Math.max(minX, Math.min(maxX, s.catcherTargetX));
      s.catcherTargetY = Math.max(minY, Math.min(maxY, s.catcherTargetY));

      const prevX = s.catcherX;
      const prevY = s.catcherY;
      s.catcherX += (s.catcherTargetX - s.catcherX) * 0.25;
      s.catcherY += (s.catcherTargetY - s.catcherY) * 0.25;
      s.catcherX = Math.max(minX, Math.min(maxX, s.catcherX));
      s.catcherY = Math.max(minY, Math.min(maxY, s.catcherY));
      s.catcherVx = (s.catcherX - prevX) / Math.max(dt, 0.016);
      s.catcherVy = (s.catcherY - prevY) / Math.max(dt, 0.016);

      const isInvulnerable = currentTime < s.invulnerableUntil;
      if (isInvulnerable) {
        ctx.globalAlpha = 0.35 + 0.55 * Math.abs(Math.sin(currentTime * 0.018));
      }

      drawHotAirBalloon(
        ctx,
        s.catcherX,
        s.catcherY,
        s.catcherWidth,
        s.catcherHeight,
        currentTime,
        s.bannerAuthor,
        s.bannerMessage,
        s.catcherVx,
        s.catcherVy,
        s.bannerIsSponsor,
        s.balloonBursted
      );

      if (isInvulnerable) {
        ctx.globalAlpha = 1.0;
      }

      const triggerBalloonBurst = (hitX: number, hitY: number) => {
        s.balloonBursted = true;
        s.screenShake = 18;
        playSound('burst');

        const envY = s.catcherY - 76;

        // 1. Tearing rubber balloon fragments flying in all directions
        const shredColors = ['#FF2E63', '#FFD54F', '#FFF0F5', '#E11D48', '#FF69B4', '#F43F5E'];
        for (let p = 0; p < 36; p++) {
          const angle = Math.random() * Math.PI * 2;
          const spd = 120 + Math.random() * 260;
          s.particles.push({
            x: s.catcherX + (Math.random() - 0.5) * 30,
            y: envY + (Math.random() - 0.5) * 40,
            vx: Math.cos(angle) * spd,
            vy: Math.sin(angle) * spd - 60,
            alpha: 1,
            color: shredColors[Math.floor(Math.random() * shredColors.length)],
            size: 4 + Math.random() * 6,
            shape: 'shred',
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 14,
          });
        }

        // 2. White smoke / steam puffs from pop
        for (let p = 0; p < 18; p++) {
          const angle = Math.random() * Math.PI * 2;
          const spd = 40 + Math.random() * 80;
          s.particles.push({
            x: s.catcherX + (Math.random() - 0.5) * 20,
            y: envY + (Math.random() - 0.5) * 20,
            vx: Math.cos(angle) * spd,
            vy: Math.sin(angle) * spd - 30,
            alpha: 0.85,
            color: '#F1F5F9',
            size: 10 + Math.random() * 12,
            shape: 'smoke',
          });
        }

        // 3. Danger sparks from puncture impact
        for (let p = 0; p < 20; p++) {
          const angle = Math.random() * Math.PI * 2;
          const spd = 90 + Math.random() * 180;
          s.particles.push({
            x: hitX,
            y: hitY,
            vx: Math.cos(angle) * spd,
            vy: Math.sin(angle) * spd,
            alpha: 1,
            color: p % 2 === 0 ? '#EF4444' : '#FBBF24',
            size: 3 + Math.random() * 3,
          });
        }

        // 4. Dramatic floating pop message
        s.floatingTexts.push({
          id: s.nextId++,
          text: '💥 POP! BALLOON BURST!',
          x: s.catcherX,
          y: Math.max(35, envY - 25),
          alpha: 1,
          color: '#DC2626',
          isCoin: true,
        });

        setGameOverReason('burst');
        s.gameOverReason = 'burst';

        const finalDuration = Math.max(1, Math.round((performance.now() - (s.flightStartTime || performance.now())) / 1000));
        const finalTopSpeed = 1.0 + Math.min(1.8, finalDuration * 0.028);
        s.flightDuration = finalDuration;
        s.flightTopSpeed = finalTopSpeed;

        const currentFlightPoints = s.heartsCaught + s.kissesCaught * 2;
        setLastFlightScore(currentFlightPoints);

        // Accrue $KISS tokens earned this flight into vault
        if (s.kissCoins > 0) {
          setTotalKissTokens((prev) => {
            const nextTotal = prev + s.kissCoins;
            try {
              localStorage.setItem('kiss_token_vault_total', nextTotal.toString());
            } catch {
              // ignore
            }
            return nextTotal;
          });
        }

        const isRecord = currentFlightPoints > 0 && currentFlightPoints > s.highScore;
        setIsNewRecord(isRecord);
        setBannerSaved(false);
        if (isRecord) {
          s.highScore = currentFlightPoints;
          setNewBannerText('');
          const best = currentFlightPoints;
          setHighScore(best);
          try {
            localStorage.setItem('kiss_coin_high_score', best.toString());
          } catch {
            // ignore
          }
        }

        // Allow 650ms to view the explosion before the gameover screen appears
        setTimeout(() => {
          setGameState('gameover');
          s.gameState = 'gameover';
        }, 650);
      };

      if (s.gameState === 'playing' && !s.balloonBursted) {
        // Calculate flight duration in seconds
        const flightTime = s.flightStartTime > 0 ? (currentTime - s.flightStartTime) / 1000 : 0;

        // 1. Time-Based Falling Speed Multipliers (Smoothly ramps from 1.25x up to 3.0x over time)
        const speedMultiplier = 1.25 + Math.min(1.75, flightTime * 0.038);

        // 2. Wind Swerve & Flutter (Items weave wider horizontally as flight continues)
        const windSwerve = Math.min(32, 14 + flightTime * 0.32);

        // 3. Catch Window Tightening (Requires sharper piloting precision over time)
        const catchTolerance = Math.max(6, 15 - flightTime * 0.18);

        // 4. Dynamic Spawning: Drops from 880ms down to 280ms over time
        s.spawnInterval = Math.max(280, 880 - flightTime * 18 - s.heartsCaught * 7);

        // 5. Sky Dart Hazard Probability: 0% during 3s start grace period, then smoothly scales up to 28%
        const hazardChance = flightTime < 3.0 ? 0 : Math.min(0.28, 0.06 + (flightTime - 3.0) * 0.004 + s.heartsCaught * 0.002);

        if (currentTime - s.lastSpawn > s.spawnInterval) {
          s.lastSpawn = currentTime;

          const rand = Math.random();
          let kind: ItemKind = 'heart';
          const kissChance = 0.20;
          const goldenChance = 0.08; // Rare life preserver (reduced to make survival harder)

          if (rand < hazardChance) {
            kind = 'hazard'; // 📍 Sharp Sky Dart!
          } else if (rand < hazardChance + kissChance) {
            kind = 'kiss'; // 22% chance of falling kiss 💋!
          } else if (rand < hazardChance + kissChance + goldenChance) {
            kind = 'golden'; // 14% chance of golden heart 💛
          } else {
            kind = 'heart'; // Standard heart ❤️
          }

          const baseSpeed = kind === 'hazard'
            ? 275 + Math.random() * 75
            : kind === 'kiss'
            ? 240 + Math.random() * 60
            : kind === 'golden'
            ? 255 + Math.random() * 60
            : 220 + Math.random() * 65;

          // Items fall faster over time, combining time multiplier and score scaling
          const initialSpeed = (baseSpeed + s.heartsCaught * 1.5) * speedMultiplier;

          s.hearts.push({
            id: s.nextId++,
            x: Math.random() * (width - 60) + 30,
            y: -24,
            size: kind === 'kiss' ? 24 : kind === 'golden' ? 24 : kind === 'hazard' ? 22 : 20,
            speed: initialSpeed,
            wobble: Math.random() * Math.PI * 2,
            wobbleSpeed: (kind === 'hazard' ? 3.8 : kind === 'kiss' ? 3.4 : 2.5) + Math.random() * 2,
            wobbleAmount: windSwerve * (0.8 + Math.random() * 0.4),
            kind,
            rotation: 0,
          });
        }

        for (let i = s.hearts.length - 1; i >= 0; i--) {
          const h = s.hearts[i];
          // Downward gravity acceleration increases as flight time climbs
          h.speed += (42 + flightTime * 0.7) * dt;
          h.y += h.speed * dt;
          h.wobble += h.wobbleSpeed * dt * (1 + flightTime * 0.015);
          const currentWobble = h.wobbleAmount || windSwerve;
          const wobbleX = h.x + Math.sin(h.wobble) * currentWobble;

          // 1. Basket Catch Zone (pilot in basket catches it - tighter margin over time)
          const basketHitX = wobbleX >= s.catcherX - halfW - catchTolerance && wobbleX <= s.catcherX + halfW + catchTolerance;
          const basketHitY = h.y + h.size >= s.catcherY - s.catcherHeight / 2 - (catchTolerance + 2) && h.y - h.size <= s.catcherY + s.catcherHeight / 2 + 6;
          const basketHit = basketHitX && basketHitY;

          // 2. Balloon Envelope Catch Zone (intercept items with the balloon)
          const envY = s.catcherY - 76;
          const edx = wobbleX - s.catcherX;
          const edy = h.y - envY;
          const envelopeRadius = 34 + catchTolerance * 0.4 + h.size;
          const envelopeHit = (edx * edx) + (edy * edy) * 0.85 <= envelopeRadius * envelopeRadius;

          const hit = basketHit || envelopeHit;

          if (hit) {
            if (h.kind === 'hazard') {
              // If currently invulnerable (mercy frames after a hit), ignore hazard
              if (currentTime < s.invulnerableUntil) {
                s.hearts.splice(i, 1);
                continue;
              }

              const nextLives = s.lives - 1;
              s.lives = nextLives;
              setLives(nextLives);
              s.streak = 0;
              setStreak(0);

              // Sparks at hit point
              for (let p = 0; p < 16; p++) {
                const angle = Math.random() * Math.PI * 2;
                const spd = 70 + Math.random() * 120;
                s.particles.push({
                  x: wobbleX,
                  y: h.y,
                  vx: Math.cos(angle) * spd,
                  vy: Math.sin(angle) * spd,
                  alpha: 1,
                  color: p % 2 === 0 ? '#EF4444' : '#FBBF24',
                  size: 3 + Math.random() * 3,
                });
              }

              if (nextLives <= 0) {
                // Out of lives: catastrophic balloon burst & game over!
                triggerBalloonBurst(wobbleX, h.y);
              } else {
                // Survived hit: grant 1.2s invulnerability frames & screen shake
                s.invulnerableUntil = currentTime + 1200;
                s.screenShake = 12;
                playSound('miss');
                s.floatingTexts.push({
                  id: s.nextId++,
                  text: `💥 -1 LIFE! (${nextLives} left)`,
                  x: s.catcherX,
                  y: Math.max(28, h.y - 25),
                  alpha: 1,
                  color: '#EF4444',
                  isCoin: true,
                });
              }

              s.hearts.splice(i, 1);
              continue;
            }

            if (h.kind === 'kiss') {
              // Caught a Kiss! +1 Kiss Coin directly + Kiss score
              const newCoins = s.kissCoins + 1;
              const newKisses = s.kissesCaught + 1;
              const newStreak = s.streak + 1;
              s.kissCoins = newCoins;
              s.kissesCaught = newKisses;
              s.streak = newStreak;
              setKissCoins(newCoins);
              setKissesCaught(newKisses);
              setStreak(newStreak);

              playKissSoundEffect(1.0);
              playSound('kiss');

              s.floatingTexts.push({
                id: s.nextId++,
                text: `💋 MWAH! +1 🪙`,
                x: wobbleX,
                y: Math.max(28, h.y - 20),
                alpha: 1,
                color: '#E11D48',
                isCoin: true,
              });

              // Sparkle particle burst
              for (let p = 0; p < 16; p++) {
                const angle = Math.random() * Math.PI * 2;
                const spd = 70 + Math.random() * 130;
                s.particles.push({
                  x: wobbleX,
                  y: h.y,
                  vx: Math.cos(angle) * spd,
                  vy: Math.sin(angle) * spd - 45,
                  alpha: 1,
                  color: p % 2 === 0 ? '#FF2E63' : '#FFB300',
                  size: 3.5 + Math.random() * 4,
                });
              }
            } else if (h.kind === 'golden') {
              // Caught Yellow Heart! "The yellow heart keeps you alive"
              const prevLives = s.lives;
              const newLives = Math.min(3, s.lives + 1);
              const healed = newLives > prevLives;
              s.lives = newLives;
              setLives(newLives);

              const caughtBonus = healed ? 1 : 3;
              const newHearts = s.heartsCaught + caughtBonus;
              const newStreak = s.streak + 1;
              s.heartsCaught = newHearts;
              s.streak = newStreak;
              setHeartsCaught(newHearts);
              setStreak(newStreak);

              playSound('coin');
              s.floatingTexts.push({
                id: s.nextId++,
                text: healed ? `💛 +1 LIFE! (${newLives}/3)` : `💛 +3 SCORE!`,
                x: wobbleX,
                y: Math.max(28, h.y - 20),
                alpha: 1,
                color: '#F59E0B',
                isCoin: true,
              });

              for (let p = 0; p < 16; p++) {
                const angle = Math.random() * Math.PI * 2;
                const spd = 70 + Math.random() * 130;
                s.particles.push({
                  x: wobbleX,
                  y: h.y,
                  vx: Math.cos(angle) * spd,
                  vy: Math.sin(angle) * spd - 40,
                  alpha: 1,
                  color: p % 2 === 0 ? '#FBBF24' : '#F59E0B',
                  size: 3.5 + Math.random() * 4,
                });
              }
            } else {
              // Caught Red Heart: purely for score!
              const newHearts = s.heartsCaught + 1;
              const newStreak = s.streak + 1;
              s.heartsCaught = newHearts;
              s.streak = newStreak;
              setHeartsCaught(newHearts);
              setStreak(newStreak);

              playSound('catch');
              s.floatingTexts.push({
                id: s.nextId++,
                text: '+1 ❤️',
                x: wobbleX,
                y: Math.max(28, h.y - 20),
                alpha: 1,
                color: '#E11D48',
              });

              for (let p = 0; p < 12; p++) {
                const angle = Math.random() * Math.PI * 2;
                const spd = 60 + Math.random() * 120;
                s.particles.push({
                  x: wobbleX,
                  y: h.y,
                  vx: Math.cos(angle) * spd,
                  vy: Math.sin(angle) * spd - 40,
                  alpha: 1,
                  color: '#FB7185',
                  size: 3 + Math.random() * 4,
                });
              }
            }

            s.hearts.splice(i, 1);
            continue;
          }

          if (h.y > height + 20) {
            s.hearts.splice(i, 1);

            // Successfully dodging a falling hazard carries no penalty!
            if (h.kind === 'hazard') {
              continue;
            }

            // Kisses are for tokens - missing them resets streak, NO life penalty!
            if (h.kind === 'kiss') {
              s.streak = 0;
              setStreak(0);
              continue;
            }

            // Missing a HEART (Red or Yellow): each heart missed takes away a life!
            if (h.kind === 'heart' || h.kind === 'golden') {
              s.streak = 0;
              setStreak(0);

              const nextLives = s.lives - 1;
              s.lives = nextLives;
              setLives(nextLives);
              playSound('miss');

              const isYellow = h.kind === 'golden';
              const heartDesc = isYellow ? 'Yellow Heart' : 'Heart';
              const heartColor = isYellow ? '#F59E0B' : '#EF4444';

              s.floatingTexts.push({
                id: s.nextId++,
                text: nextLives > 0 ? `💔 Missed ${heartDesc}! (${nextLives} left)` : '💔 Lost all 3 lives!',
                x: wobbleX,
                y: height - 40,
                alpha: 1,
                color: heartColor,
              });

              if (nextLives <= 0) {
                setGameState('gameover');
                s.gameState = 'gameover';
                playSound('gameover');

                const finalDuration = Math.max(1, Math.round((performance.now() - (s.flightStartTime || performance.now())) / 1000));
                const finalTopSpeed = 1.0 + Math.min(1.8, finalDuration * 0.028);
                s.flightDuration = finalDuration;
                s.flightTopSpeed = finalTopSpeed;

                const currentFlightPoints = s.heartsCaught + s.kissesCaught * 2;
                setLastFlightScore(currentFlightPoints);

                // Accrue $KISS tokens earned this flight into vault
                if (s.kissCoins > 0) {
                  setTotalKissTokens((prev) => {
                    const nextTotal = prev + s.kissCoins;
                    try {
                      localStorage.setItem('kiss_token_vault_total', nextTotal.toString());
                    } catch {
                      // ignore
                    }
                    return nextTotal;
                  });
                }

                const isRecord = currentFlightPoints > 0 && currentFlightPoints > s.highScore;
                setIsNewRecord(isRecord);
                setBannerSaved(false);
                if (isRecord) {
                  s.highScore = currentFlightPoints;
                  setNewBannerText('');
                  const best = currentFlightPoints;
                  setHighScore(best);
                  try {
                    localStorage.setItem('kiss_coin_high_score', best.toString());
                  } catch {
                    // ignore
                  }
                }
              }
              continue;
            }
          }

          if (h.kind === 'kiss') {
            drawKiss(ctx, wobbleX, h.y, h.size, h.wobble);
          } else if (h.kind === 'golden') {
            drawHeart(ctx, wobbleX, h.y, h.size, '#F59E0B', true, h.wobble);
          } else if (h.kind === 'hazard') {
            drawHazardDart(ctx, wobbleX, h.y, h.size, h.wobble);
          } else {
            drawHeart(ctx, wobbleX, h.y, h.size, '#FF2E63', false, h.wobble);
          }
        }
      }

      for (let pIdx = s.particles.length - 1; pIdx >= 0; pIdx--) {
        const p = s.particles[pIdx];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += (p.shape === 'smoke' ? -25 : 180) * dt;
        p.alpha -= (p.shape === 'smoke' ? 1.0 : 1.6) * dt;
        if (p.rotation !== undefined && p.rotationSpeed !== undefined) {
          p.rotation += p.rotationSpeed * dt;
        }

        if (p.alpha <= 0) {
          s.particles.splice(pIdx, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.fillStyle = p.color;

        if (p.shape === 'shred') {
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation || 0);
          ctx.beginPath();
          ctx.rect(-p.size, -p.size / 2, p.size * 2, p.size);
          ctx.fill();
        } else if (p.shape === 'smoke') {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      for (let tIdx = s.floatingTexts.length - 1; tIdx >= 0; tIdx--) {
        const ft = s.floatingTexts[tIdx];
        ft.y -= 45 * dt;
        ft.alpha -= 0.9 * dt;

        if (ft.alpha <= 0) {
          s.floatingTexts.splice(tIdx, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = ft.alpha;
        ctx.font = ft.isCoin ? 'bold 16px sans-serif' : 'bold 14px sans-serif';
        ctx.fillStyle = ft.color;
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(255, 255, 255, 0.9)';
        ctx.shadowBlur = 6;
        ctx.fillText(ft.text, ft.x, ft.y);
        ctx.restore();
      }

      ctx.restore(); // Restore screenShake translation
    };

    animId = requestAnimationFrame(loop);

    const handleMove = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const halfW = stateRef.current.catcherWidth / 2;
      const minX = halfW + 6;
      const maxX = rect.width - halfW - 6;
      const minY = 95;
      const maxY = rect.height - 26;
      stateRef.current.catcherTargetX = Math.max(minX, Math.min(maxX, x));
      stateRef.current.catcherTargetY = Math.max(minY, Math.min(maxY, y));
    };

    let isDragging = false;

    const onPointerDown = (e: PointerEvent) => {
      isDragging = true;
      handleMove(e.clientX, e.clientY);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (isDragging || e.target === canvas) {
        handleMove(e.clientX, e.clientY);
      }
    };

    const onPointerUp = () => {
      isDragging = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        e.preventDefault();
        handleMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        e.preventDefault();
        handleMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS', 'a', 'd', 'w', 's'];
      if (keys.includes(e.key) || keys.includes(e.code)) {
        stateRef.current.keysPressed.add(e.key.toLowerCase());
        stateRef.current.keysPressed.add(e.code);
        if (e.key.startsWith('Arrow')) {
          e.preventDefault();
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      stateRef.current.keysPressed.delete(e.key.toLowerCase());
      stateRef.current.keysPressed.delete(e.code);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resizeCanvas);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchstart', onTouchStart);
    };
  }, [highScore, playSound]);

  return (
    <div className="w-full h-full max-w-md mx-auto flex flex-col items-center select-none text-white min-h-0">
      {/* Top HUD with $KISS Crypto Token Vault & Flight Stats */}
      <div className="w-full bg-zinc-950/90 backdrop-blur-xl rounded-2xl shadow-[0_4px_25px_rgba(0,0,0,0.8)] border border-zinc-800/90 px-3 py-2 mb-2 flex items-center justify-between text-white shrink-0">
        <div className="flex items-center gap-2">
          {/* Kiss Coins Badge */}
          <div className="flex items-center gap-1.5 shrink-0" title={`Kiss Coins: ${totalKissTokens}`}>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-rose-950/90 via-pink-900/60 to-zinc-900 border border-rose-500/80 shadow-[0_0_12px_rgba(244,63,94,0.4)] flex items-center justify-center shrink-0">
              <BalloonKissIcon size={22} />
            </div>
            <div>
              <div className="text-[9px] text-rose-400 font-black uppercase tracking-wider leading-none mb-0.5">
                Kiss Coins
              </div>
              <div className="text-sm font-black text-white leading-none drop-shadow-[0_0_8px_rgba(244,63,94,0.7)]">
                {totalKissTokens}
              </div>
            </div>
          </div>
        </div>

        {/* Right side controls: In-flight stats during playing, or Wallet Verification & Best Score when idle */}
        <div className="flex items-center gap-2 shrink-0">
          {(gameState === 'playing' || gameState === 'paused') ? (
            <div className="flex items-center gap-1.5 animate-fade-in">
              <div className="text-center bg-zinc-900/90 rounded-xl px-2 py-1 border border-zinc-800 shadow-inner">
                <div className="text-[7.5px] text-zinc-400 font-black uppercase tracking-wider leading-none mb-0.5">Score</div>
                <div className="text-xs sm:text-sm font-black text-rose-400 leading-none">
                  {heartsCaught}
                </div>
              </div>

              <div className="text-center bg-zinc-900/90 rounded-xl px-2 py-1 border border-zinc-800 shadow-inner">
                <div className="text-[7.5px] text-zinc-400 font-black uppercase tracking-wider leading-none mb-0.5">Kisses</div>
                <div className="text-xs sm:text-sm font-black text-pink-400 flex items-center justify-center gap-0.5 leading-none">
                  💋 {kissesCaught}
                </div>
              </div>

              <div className="flex gap-0.5 items-center bg-zinc-900/90 rounded-xl px-1.5 py-1 border border-zinc-800 shadow-inner" title="Lives">
                {[1, 2, 3].map((heartIndex) => (
                  <span
                    key={heartIndex}
                    className={`text-xs transition-all duration-200 ${
                      heartIndex <= lives ? 'scale-100 filter drop-shadow-[0_0_6px_rgba(245,158,11,0.9)]' : 'scale-75 opacity-20 grayscale'
                    }`}
                  >
                    💛
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 animate-fade-in">
              <WalletVerification mode="compact" />
              {highScore > 0 && (
                <div className="hidden xs:flex items-center gap-1 bg-zinc-900/90 border border-amber-500/30 rounded-xl px-2 py-1" title={`Best: ${highScore}`}>
                  <span className="text-xs">🏆</span>
                  <span className="text-xs font-black text-amber-300">{highScore}</span>
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="w-8 h-8 rounded-full bg-zinc-900 hover:bg-zinc-850 border border-zinc-700/80 text-zinc-300 flex items-center justify-center transition-all active:scale-95 shadow-xs shrink-0 cursor-pointer"
            title={soundEnabled ? 'Mute Sound' : 'Enable Sound'}
            aria-label={soundEnabled ? 'Mute Sound' : 'Enable Sound'}
          >
            {soundEnabled ? (
              <svg
                className="w-4 h-4 text-zinc-200"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            ) : (
              <svg
                className="w-4 h-4 text-zinc-500"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="22" y1="9" x2="16" y2="15" />
                <line x1="16" y1="9" x2="22" y2="15" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <div className="relative flex-1 w-full rounded-[28px] sm:rounded-[36px] overflow-hidden border-2 border-zinc-800 shadow-[0_0_50px_rgba(244,63,94,0.25)] bg-black ring-1 ring-rose-500/20 min-h-0">
        <canvas ref={canvasRef} className="w-full h-full block cursor-grab active:cursor-grabbing touch-none" />

        {/* Start / Idle Screen: Solid Black Screen with Corky Title + Balloon + PLAY GAME Button */}
        {gameState === 'idle' && (
          <div className="absolute inset-0 bg-black flex flex-col items-center justify-center p-6 text-center animate-fade-in text-white z-30">
            <div className="flex flex-col items-center text-center max-w-xs">
              
              {/* Corky & Fun Title above the Balloon */}
              <div className="mb-5 flex flex-col items-center select-none">
                <h1 className="font-quirky text-4xl sm:text-5xl font-black tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-rose-400 via-pink-300 to-amber-300 drop-shadow-[0_4px_16px_rgba(244,63,94,0.85)] transform -rotate-2 hover:rotate-0 transition-transform flex items-center justify-center gap-2.5">
                  <span>Balloon Kiss</span>
                  <span className="inline-block text-3xl sm:text-4xl filter drop-shadow-[0_0_10px_rgba(244,63,94,0.9)] animate-pulse">🎈</span>
                </h1>
                <p className="font-quirky text-xs sm:text-sm font-extrabold text-pink-300/85 mt-1 drop-shadow-sm tracking-wide">
                  Catch kisses • Stay alive! 💋
                </p>
              </div>

              {/* Picture: High-Res Balloon Kiss Artwork with Glowing Neon Rose Frame */}
              <KissBalloonIcon
                className="w-36 h-36 sm:w-44 sm:h-44 rounded-[32px] overflow-hidden border-2 border-rose-500/80 shadow-[0_0_40px_rgba(244,63,94,0.65)] ring-2 ring-rose-500/30 mb-8 transition-transform hover:scale-105"
                size={176}
              />

              {/* BIG PLAY GAME Button */}
              <button
                type="button"
                onClick={handleStartGameWithAuth}
                className="group relative w-64 h-[74px] bg-gradient-to-r from-rose-600 via-pink-600 to-rose-500 hover:from-rose-500 hover:to-pink-500 text-white font-black rounded-3xl shadow-[0_0_45px_rgba(244,63,94,0.85)] border border-rose-400/60 active:scale-95 transition-all flex items-center justify-center gap-3.5 select-none cursor-pointer"
              >
                <div className="w-12 h-12 rounded-2xl bg-white text-rose-600 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                  <svg className="w-6 h-6 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5.14v13.72a1 1 0 001.5.86l11-6.86a1 1 0 000-1.72l-11-6.86a1 1 0 00-1.5.86z" />
                  </svg>
                </div>
                <span className="font-quirky text-2xl font-black tracking-wider leading-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">
                  PLAY GAME
                </span>
              </button>

            </div>
          </div>
        )}

        {/* Game Over Screen: Translucent Frosted Glass & Polished Results */}
        {gameState === 'gameover' && (
          <div className="absolute inset-0 bg-black/85 backdrop-blur-xl flex flex-col items-center justify-center p-4 text-center animate-fade-in text-white z-20">
            <div className="w-full max-w-[320px] bg-zinc-950/95 backdrop-blur-2xl rounded-[32px] border border-zinc-800 shadow-[0_0_60px_rgba(244,63,94,0.35)] p-5 flex flex-col items-center text-center">
              <div className="text-4xl mb-1 filter drop-shadow-[0_0_10px_rgba(244,63,94,0.5)]">
                {isNewRecord ? '🏆' : '🎈'}
              </div>
              <h2 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-rose-400 to-pink-400 mb-1 drop-shadow-[0_0_12px_rgba(244,63,94,0.5)]">
                {isNewRecord ? 'Congratulations!' : 'Game Over'}
              </h2>
              {isNewRecord ? (
                <p className="text-xs font-black text-amber-300 mb-3 drop-shadow-[0_0_8px_rgba(245,158,11,0.5)] px-1 leading-snug">
                  Now you can leave a message on the banner!
                </p>
              ) : (
                <div className="mb-2" />
              )}

              {/* Score & Best */}
              <div className="flex items-center justify-center gap-6 mb-4 bg-zinc-900/90 border border-zinc-800 rounded-2xl py-3 px-6 w-full shadow-inner">
                <div className="text-center">
                  <div className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">Score</div>
                  <div className="text-2xl font-black text-rose-400 leading-tight">
                    {lastFlightScore}
                  </div>
                </div>
                <div className="w-px h-8 bg-zinc-750" />
                <div className="text-center">
                  <div className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">Best Score</div>
                  <div className="text-2xl font-black text-amber-400 leading-tight">
                    {highScore}
                  </div>
                </div>
              </div>

              {/* IF NEW RECORD: Message composer with 1-hour VIP shield queue support */}
              {isNewRecord && (
                <div className="w-full mb-3.5 bg-gradient-to-b from-amber-950/40 to-zinc-900/90 border border-amber-500/40 rounded-2xl p-3 shadow-inner">
                  {!bannerSaved && (
                    <div className="text-[11px] font-extrabold text-amber-300 mb-2 leading-tight text-center">
                      ✨ Congratulations! Now you can leave a message on the banner:
                    </div>
                  )}
                  {bannerSaved ? (
                    isBannerQueued ? (
                      <div className="text-[11px] font-bold text-amber-300 bg-amber-950/60 border border-amber-700/80 py-2 px-3 rounded-xl text-left leading-tight">
                        <span className="font-black text-amber-400">🛡️ Record Broken!</span> Active 1-hour flight in progress, your message &quot;{newBannerText.trim() || 'Kiss the sky! 💋'}&quot; will fly next!
                      </div>
                    ) : (
                      <div className="text-xs font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-700/80 py-2 px-3 rounded-xl">
                        ✓ Flying on banner: &quot;{bannerMessage}&quot;
                      </div>
                    )
                  ) : (
                    <form onSubmit={handleSaveBanner} className="flex flex-col gap-1.5">
                      {isBannerShielded && bannerRemainingSeconds > 0 && (
                        <div className="text-[10px] font-semibold text-amber-300 bg-amber-950/70 border border-amber-700/80 rounded-lg px-2 py-1 text-left flex items-center gap-1">
                          <span>🛡️</span>
                          <span>Active 1-hour flight in progress ({Math.floor(bannerRemainingSeconds / 60)}m left) — your banner will queue to fly next!</span>
                        </div>
                      )}
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          maxLength={65}
                          value={newBannerText}
                          onChange={(e) => setNewBannerText(e.target.value)}
                          placeholder="Your message on the banner..."
                          className="flex-1 px-3 py-2 text-xs rounded-xl border border-amber-500/50 bg-zinc-950 font-medium text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                        <button
                          type="submit"
                          className="px-4 py-2 bg-gradient-to-r from-amber-500 to-rose-500 hover:from-amber-600 hover:to-rose-600 text-white text-xs font-black rounded-xl shadow-xs active:scale-95 whitespace-nowrap cursor-pointer"
                        >
                          Send 🎈
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}

              {/* Primary Action: Play Again */}
              <button
                type="button"
                onClick={startGame}
                className="group relative w-full max-w-[270px] h-[60px] bg-gradient-to-r from-rose-600 via-pink-600 to-rose-500 hover:from-rose-500 hover:to-pink-500 text-white font-black rounded-3xl shadow-[0_0_30px_rgba(244,63,94,0.7)] border border-rose-400/60 active:scale-95 transition-all flex items-center justify-center gap-3 mb-2.5 select-none cursor-pointer"
              >
                <div className="w-9 h-9 rounded-xl bg-white text-rose-600 flex items-center justify-center shadow-xs group-hover:scale-110 transition-transform">
                  <svg className="w-5 h-5 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5.14v13.72a1 1 0 001.5.86l11-6.86a1 1 0 000-1.72l-11-6.86a1 1 0 00-1.5.86z" />
                  </svg>
                </div>
                <span className="text-base font-black tracking-wide">Play Again 🎈</span>
              </button>

              {/* 1 WLD Message Button */}
              <button
                type="button"
                onClick={() => {
                  setSponsorMessage('');
                  setShowWldModal(true);
                }}
                className="w-full max-w-[270px] py-2.5 bg-gradient-to-r from-amber-600 to-rose-600 text-white font-extrabold text-xs rounded-2xl shadow-[0_0_16px_rgba(245,158,11,0.3)] active:scale-95 transition-all flex items-center justify-center gap-1.5 border border-amber-500/60 cursor-pointer"
                title="Leave message on banner for one hour — 1 WLD"
              >
                <span className="text-sm">💎</span>
                <span>Leave message on banner for one hour — 1 WLD</span>
              </button>
            </div>
          </div>
        )}

        {/* 1 WLD Message Override Modal */}
        {showWldModal && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fade-in">
            <div className="w-full max-w-xs bg-zinc-950 border-2 border-amber-500/80 rounded-3xl p-4 shadow-[0_0_50px_rgba(245,158,11,0.3)] text-left text-white">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-amber-950/80 border border-amber-500/60 flex items-center justify-center text-lg shadow-xs">
                    🎈
                  </div>
                  <div>
                    <div className="text-xs font-black text-amber-400 uppercase tracking-wider leading-tight">
                      Leave Message on Banner
                    </div>
                    <div className="text-[10px] font-bold text-zinc-400">
                      Flies for 1 Hour • 1 WLD
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setShowWldModal(false)}
                  className="w-6 h-6 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center justify-center text-xs font-bold transition-colors cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {/* Clear Explanation Card */}
              <div className="bg-zinc-900/90 border border-amber-500/30 rounded-2xl p-2.5 mb-3 text-[11px] text-zinc-300 space-y-1.5 leading-snug">
                <div className="flex items-start gap-1.5">
                  <span className="text-xs shrink-0 mt-0.5">⏱️</span>
                  <span><strong>1-Hour Guaranteed Flight:</strong> Your custom message flies across the hot air balloon banner for 60 minutes for every player in the world.</span>
                </div>
                <div className="flex items-start gap-1.5">
                  <span className="text-xs shrink-0 mt-0.5">🛡️</span>
                  <span><strong>Protected Shield:</strong> High scores cannot bump your banner during your hour. New champions are queued to fly right after your 60 minutes end.</span>
                </div>
                <div className="flex items-start gap-1.5">
                  <span className="text-xs shrink-0 mt-0.5">🌍</span>
                  <span><strong>Live Global Broadcast:</strong> Show your handle, shoutout, or greeting in real-time across World App.</span>
                </div>
              </div>

              <form onSubmit={handlePayWldOverride} className="flex flex-col gap-2 mb-1">
                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-extrabold text-zinc-400 uppercase">Your Message</label>
                    <span className="text-[9px] font-bold text-zinc-500">{sponsorMessage.length}/65</span>
                  </div>
                  <input
                    type="text"
                    maxLength={65}
                    value={sponsorMessage}
                    onChange={(e) => setSponsorMessage(e.target.value)}
                    placeholder="Your message on the balloon (e.g. Kiss the sky! 💋)"
                    className="w-full mt-0.5 px-3 py-2 text-xs rounded-xl border border-zinc-700 bg-zinc-900 font-medium text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500 shadow-inner"
                  />
                </div>

                <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-2 text-[10.5px] text-zinc-300 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-bold text-amber-400">
                    <span className="text-base">🪙</span> Cost: 1.0 WLD
                  </span>
                  <span className="text-[10px] text-amber-400 font-bold bg-amber-950/80 border border-amber-600/50 px-1.5 py-0.5 rounded-md">Flies for 1 Hour</span>
                </div>

                {wldPayState === 'success' && (
                  <div className="bg-emerald-950/80 border border-emerald-500 text-emerald-300 text-xs font-bold py-2 px-3 rounded-xl text-center">
                    ✓ 1 WLD Approved! Your message is now flying for 1 hour 🎈
                  </div>
                )}

                {wldPayState === 'failed' && (
                  <div className="bg-rose-950/80 border border-rose-500 text-rose-300 text-xs font-bold py-2 px-3 rounded-xl text-center">
                    Payment cancelled or failed. Please try again.
                  </div>
                )}

                <button
                  type="submit"
                  disabled={wldPayState === 'pending'}
                  className="w-full py-2.5 bg-gradient-to-r from-amber-500 via-rose-500 to-pink-600 hover:from-amber-600 hover:to-rose-600 text-white font-black text-xs rounded-xl shadow-md transition-transform active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {wldPayState === 'pending' ? 'Processing 1 WLD...' : 'Pay 1 WLD & Fly Message for 1 Hour 🎈'}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
