import { useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation, useParams } from 'wouter';
import type { FormEvent, ReactNode } from 'react';
import QRCode from 'qrcode';
import {
  ArrowLeft, ArrowRight, ChevronRight, LogOut, RefreshCw, ShieldCheck, Trophy,
} from 'lucide-react';
import {
  getGetAdminDashboardQueryKey, getGetLobbyQueryKey, getGetRoomQueryKey,
  getGetSessionQueryKey, useCompleteWithdrawal, useCreateDeposit, useCreateWithdrawal,
  useDecideDeposit, useGetAdminDashboard, useGetLobby, useGetRoom, useGetSession,
  useJoinRoom, useLeaveRoom, useSignIn, useSignOut, useSignUp, useSubmitRoomScore,
  useUpdateAdminSettings,
} from '@workspace/api-client-react';
import type {
  AdminDashboard, AdminSettings, Game, Room, RoomOption, RoomOptionId,
  RoomJoinInputGameId, RoomJoinInputOptionId, Transaction,
} from '@workspace/api-client-react';

const queryClient = new QueryClient();
const money = (amount = 0) => `₹${Number(amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const dateLabel = (date: string) => new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const safeError = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
const options: RoomOption[] = [
  { id: 'duo20', title: '2-player room', playerCount: 2, entryFee: 20, prize: 32.4, adminKeeps: 7.6 },
  { id: 'duo50', title: '2-player room', playerCount: 2, entryFee: 50, prize: 81, adminKeeps: 19 },
  { id: 'quad20', title: '4-player room', playerCount: 4, entryFee: 20, prize: 60, adminKeeps: 20 },
  { id: 'quad50', title: '4-player room', playerCount: 4, entryFee: 50, prize: 150, adminKeeps: 50 },
];

function AppFrame({ children, user }: { children: ReactNode; user?: { displayName: string; role: string } | null }) {
  const signOut = useSignOut();
  const client = useQueryClient();
  const [, setLocation] = useLocation();
  const [path] = useLocation();
  const nav = [
    { label: 'Lobby', href: '/' }, { label: 'Add cash', href: '/add-cash' },
    { label: 'Withdraw', href: '/withdraw' }, ...(user?.role === 'admin' ? [{ label: 'Admin', href: '/admin' }] : []),
  ];
  const logout = () => signOut.mutate(undefined, { onSuccess: () => {
    client.invalidateQueries({ queryKey: getGetSessionQueryKey() });
    client.invalidateQueries({ queryKey: getGetLobbyQueryKey() }); setLocation('/');
  } });
  return <div className="shell">
    <header className="topbar">
      <Link href="/" className="brand"><span className="brand-mark">K</span><span>KHELO<span style={{ color: '#16805e' }}>.</span></span></Link>
      <nav className="topnav" aria-label="Main navigation">{nav.map(item => <Link key={item.href} href={item.href} className={path === item.href ? 'active' : ''}>{item.label}</Link>)}</nav>
      {user ? <div className="account"><span className="avatar">{user.displayName.slice(0, 1).toUpperCase()}</span><span>{user.displayName}</span><button className="btn btn-soft btn-small" onClick={logout} disabled={signOut.isPending} aria-label="Sign out"><LogOut size={14} /></button></div> : <Link href="/" className="btn btn-primary btn-small">Sign in</Link>}
    </header>
    {user && <nav className="mobile-menu" aria-label="Mobile navigation">{nav.map(item => <Link key={item.href} href={item.href} className={path === item.href ? 'active' : ''}>{item.label}</Link>)}</nav>}
    {children}
  </div>;
}

function AuthScreen({ onAuth }: { onAuth: () => void }) {
  const signup = useSignUp(); const signin = useSignIn(); const client = useQueryClient();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const mutation = mode === 'signin' ? signin : signup;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const onSuccess = () => { client.invalidateQueries({ queryKey: getGetSessionQueryKey() }); client.invalidateQueries({ queryKey: getGetLobbyQueryKey() }); onAuth(); };
    if (mode === 'signin') signin.mutate({ data: { email, password } }, { onSuccess });
    else signup.mutate({ data: { email, displayName: name, password } }, { onSuccess });
  };
  return <AppFrame user={null}><main className="auth-wrap"><section className="auth-card">
    <div className="eyebrow">Real players. Clear winnings.</div><h1>{mode === 'signin' ? 'Back in the game.' : 'Make your move.'}</h1>
    <p>Quick skill matches with one transparent Total Money balance. New players receive ₹10 to get started.</p>
    <form onSubmit={submit}>
      {mode === 'signup' && <div className="input-wrap"><label htmlFor="display-name">Display name</label><input id="display-name" required minLength={2} maxLength={40} value={name} onChange={e => setName(e.target.value)} placeholder="Your player name" /></div>}
      <div className="input-wrap"><label htmlFor="email">Email address</label><input id="email" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></div>
      <div className="input-wrap"><label htmlFor="password">Password</label><input id="password" type="password" required minLength={mode === 'signup' ? 10 : 1} value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === 'signup' ? 'At least 10 characters' : 'Your password'} /></div>
      {mutation.isError && <div className="error-text" role="alert">{safeError(mutation.error)}</div>}
      <button className="btn btn-primary" type="submit" disabled={mutation.isPending} style={{ width: '100%', marginTop: 8 }}>{mutation.isPending ? 'One moment…' : mode === 'signin' ? 'Sign in' : 'Create account'}</button>
    </form>
    <button className="auth-switch" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); signin.reset(); signup.reset(); }}>{mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}</button>
  </section></main></AppFrame>;
}

function LoadingState() { return <main className="loading-page"><div className="skeleton" /><div style={{ height: 18 }} /><div className="skeleton" style={{ height: 130 }} /></main>; }
function QueryError({ retry, message }: { retry: () => void; message: string }) {
  return <div className="panel" style={{ maxWidth: 600, margin: '60px auto', textAlign: 'center' }}><h2>We hit a pause.</h2><p>{message}</p><button className="btn btn-primary" onClick={retry}><RefreshCw size={14} />Try again</button></div>;
}
function Status({ value }: { value: string }) { return <span className={`status ${value}`}>{value}</span>; }

function Lobby({ user, wallet, games, transactions, activeRoom, retry }: {
  user: { displayName: string }; wallet: { totalMoney: number }; games: Game[]; transactions: Transaction[]; activeRoom: Room | null; retry: () => void;
}) {
  const [gameId, setGameId] = useState<RoomJoinInputGameId>('snake');
  const join = useJoinRoom(); const client = useQueryClient(); const [, setLocation] = useLocation();
  const orderedGames = useMemo(() => {
    const canonical = ['snake', 'clicker', 'tic-tac-toe'];
    return canonical.map(id => games.find(game => game.id === id)).filter((game): game is Game => Boolean(game));
  }, [games]);
  const selectedGame = orderedGames.find(game => game.id === gameId) ?? orderedGames[0];
  const joinRoom = (optionId: RoomOptionId) => {
    if (!selectedGame) return;
    join.mutate({ data: { gameId: selectedGame.id as RoomJoinInputGameId, optionId: optionId as RoomJoinInputOptionId } }, {
      onSuccess: room => { client.invalidateQueries({ queryKey: getGetLobbyQueryKey() }); client.invalidateQueries({ queryKey: getGetRoomQueryKey(room.id) }); setLocation(`/rooms/${room.id}`); },
    });
  };
  return <AppFrame user={user}><main className="page">
    <section className="hero"><div className="hero-copy"><div className="eyebrow" style={{ color: '#a9c4b3' }}>Khelo skill club / real-player rooms</div><h1>Ready when<br />you are.</h1><p>Pick your game, choose a room, and play only when every real-player slot is filled.</p><Link className="btn btn-yellow" href="#rooms">Choose a room <ArrowRight size={15} /></Link></div><div className="hero-art" aria-hidden="true"><div className="hero-token">₹</div><div className="hero-label">one Total Money balance</div></div></section>
    <section><div className="section-head"><div><div className="eyebrow">Your wallet</div><h2>One balance. No guesswork.</h2></div><Link href="/add-cash" className="btn btn-soft btn-small">Add cash <ChevronRight size={13} /></Link></div>
      <div className="wallet-card" data-testid="wallet-total-money"><div className="wallet-name">Total Money</div><div className="wallet-value">{money(wallet.totalMoney)}</div><div className="wallet-foot">Signup bonus ₹10 is included in your unified balance.</div><Link href="/withdraw" className="btn btn-soft btn-small wallet-action">Withdraw</Link></div>
    </section>
    {activeRoom && <section className="notice green" style={{ marginTop: 18 }}><strong>You have a room in progress.</strong> {activeRoom.gameName} · {activeRoom.status === 'waiting' ? 'Searching for players...' : activeRoom.status}. <Link href={`/rooms/${activeRoom.id}`} style={{ fontWeight: 800 }}>Return to room</Link></section>}
    <section id="rooms"><div className="section-head"><div><div className="eyebrow">Choose your challenge</div><h2>Three games. Four room choices.</h2></div><span className="eyebrow">real players only</span></div>
      <div className="games-strip" role="tablist" aria-label="Choose a game">{orderedGames.map(game => <button key={game.id} role="tab" aria-selected={game.id === selectedGame?.id} className={`game-tab${game.id === selectedGame?.id ? ' selected' : ''}`} onClick={() => setGameId(game.id as RoomJoinInputGameId)}><strong>{game.name}</strong><span>{game.description}</span></button>)}</div>
      {!selectedGame ? <div className="panel empty">Games are unavailable right now. <button onClick={retry} className="auth-switch">Reload lobby</button></div> :
      <><div className="room-grid" style={{ marginTop: 12 }}>{options.map((option, index) => <article className={`room-card${index === 1 ? ' featured' : ''}`} key={option.id} data-testid={`room-option-${option.id}`}>
        <span className="eyebrow">{option.playerCount} real players</span><span className="room-fee">{money(option.entryFee)} entry</span><h3 className="room-title">{option.title}</h3><p className="room-prize">Winner receives <strong>{money(option.prize)}</strong></p>
        <button className={`btn ${index === 1 ? 'btn-yellow' : 'btn-primary'}`} onClick={() => joinRoom(option.id)} disabled={join.isPending || Boolean(activeRoom)}>{join.isPending ? 'Joining…' : `Join for ${money(option.entryFee)}`}</button>
      </article>)}</div>
      {join.isError && <div className="error-text" role="alert">{safeError(join.error)}</div>}
      {activeRoom && <p className="helper" style={{ marginTop: 10 }}>Leave your current waiting room before joining another match.</p>}</>}
    </section>
    <section><div className="section-head"><div><div className="eyebrow">Wallet ledger</div><h2>Recent activity</h2></div></div><ActivityTable transactions={transactions} /></section>
  </main></AppFrame>;
}

function ActivityTable({ transactions }: { transactions: Transaction[] }) {
  if (!transactions.length) return <div className="activity"><div className="empty">Your wallet activity will appear here.</div></div>;
  return <div className="activity"><div className="activity-row activity-head"><span>Type</span><span>Reference</span><span>Amount</span><span>Status</span></div>
    {transactions.slice(0, 5).map(row => <div className="activity-row" key={row.id} data-testid={`row-transaction-${row.id}`}><strong style={{ textTransform: 'capitalize' }}>{row.type}</strong><span>{dateLabel(row.createdAt)}</span><span>{money(row.amount)}</span><Status value={row.status} /></div>)}
  </div>;
}

function DepositPage({ user, totalMoney, settings }: { user: { displayName: string }; totalMoney: number; settings: AdminSettings }) {
  const create = useCreateDeposit(); const client = useQueryClient();
  const [amount, setAmount] = useState(''); const [utr, setUtr] = useState(''); const [fileData, setFileData] = useState(''); const [fileName, setFileName] = useState(''); const [sent, setSent] = useState(false); const [fileError, setFileError] = useState('');
  const onFile = (file?: File) => { if (!file) return; if (file.size > 2_000_000) { setFileError('Image must be smaller than 2 MB.'); return; } setFileError(''); const reader = new FileReader(); reader.onload = () => { setFileData(String(reader.result || '')); setFileName(file.name); }; reader.readAsDataURL(file); };
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSent(false); create.mutate({ data: { amount: Number(amount), utr, screenshotDataUrl: fileData } }, { onSuccess: () => { setSent(true); setAmount(''); setUtr(''); setFileData(''); setFileName(''); client.invalidateQueries({ queryKey: getGetLobbyQueryKey() }); } }); };
  return <AppFrame user={user}><main className="page"><div className="subpage-head"><div><div className="eyebrow">Wallet / deposit</div><h1>Add cash</h1><p>Pay by UPI and submit your reference and proof. Deposits are reviewed before they appear in Total Money.</p></div><Link href="/" className="btn btn-soft btn-small"><ArrowLeft size={13} />Lobby</Link></div>
    <div className="two-col"><section className="panel"><h2>Request a deposit</h2><p>Current Total Money: <strong>{money(totalMoney)}</strong></p>
      <div className="notice green" style={{ display: 'flex', gap: 17, alignItems: 'center', flexWrap: 'wrap' }}><div><strong>Pay to this UPI ID</strong><br /><span className="font-mono">{settings.adminUpiId || 'UPI details are not configured'}</span></div>{settings.adminQrCodeUrl && <img className="qr" src={settings.adminQrCodeUrl} alt="Admin payment QR code" />}</div>
      <form onSubmit={submit}><div className="input-wrap"><label htmlFor="deposit-amount">Amount (₹)</label><input id="deposit-amount" type="number" min="50" max="500" step="1" required value={amount} onChange={e => setAmount(e.target.value)} placeholder="50–500" /><span className="helper">Minimum ₹50 · Maximum ₹500</span></div>
        <div className="input-wrap"><label htmlFor="deposit-utr">UPI transaction reference (UTR)</label><input id="deposit-utr" required minLength={6} maxLength={64} value={utr} onChange={e => setUtr(e.target.value)} placeholder="Transaction reference" /></div>
        <div className="input-wrap"><label htmlFor="deposit-proof">Payment screenshot</label><input id="deposit-proof" type="file" accept="image/*" required onChange={e => onFile(e.target.files?.[0])} /><span className="helper">{fileName || 'PNG or JPG, up to 2 MB'}</span></div>
        {(fileError || create.isError) && <div className="error-text" role="alert">{fileError || safeError(create.error)}</div>}
        <button className="btn btn-primary" type="submit" disabled={create.isPending || !fileData || Number(amount) < 50 || Number(amount) > 500} style={{ width: '100%' }}>{create.isPending ? 'Sending request…' : 'Submit deposit request'}</button>
      </form>{sent && <div className="success-box" role="status">Deposit request submitted for review.</div>}
    </section><aside className="panel"><div className="eyebrow">How it works</div><h2 style={{ marginTop: 9 }}>A clear, manual check.</h2><p>Your submitted UTR and screenshot are matched to the payment. Approved funds are added to your unified Total Money balance.</p>
      <div style={{ display: 'grid', gap: 15, marginTop: 21 }}>{[['01', 'Pay via UPI', 'Send the amount using the QR or UPI ID'], ['02', 'Share the proof', 'Enter the exact UTR and upload the receipt'], ['03', 'Review', 'Funds appear after approval']].map(item => <div key={item[0]} style={{ display: 'flex', gap: 13 }}><span className="font-mono" style={{ color: '#16805e' }}>{item[0]}</span><div><strong style={{ fontSize: 12 }}>{item[1]}</strong><div className="helper" style={{ marginTop: 4 }}>{item[2]}</div></div></div>)}</div>
    </aside></div></main></AppFrame>;
}

function WithdrawalPage({ user, totalMoney }: { user: { displayName: string }; totalMoney: number }) {
  const create = useCreateWithdrawal(); const client = useQueryClient();
  const [amount, setAmount] = useState(''); const [upiId, setUpiId] = useState(''); const [sent, setSent] = useState(false);
  const numeric = Number(amount) || 0; const tax = Math.round(numeric * 5) / 100; const payout = Math.round((numeric - tax) * 100) / 100;
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSent(false); create.mutate({ data: { amount: numeric, upiId } }, { onSuccess: () => { setSent(true); setAmount(''); setUpiId(''); client.invalidateQueries({ queryKey: getGetLobbyQueryKey() }); } }); };
  return <AppFrame user={user}><main className="page"><div className="subpage-head"><div><div className="eyebrow">Wallet / payout</div><h1>Withdraw winnings</h1><p>Choose a payout amount and UPI ID. The 5% tax and exact net amount are shown before you submit.</p></div><Link href="/" className="btn btn-soft btn-small"><ArrowLeft size={13} />Lobby</Link></div>
    <div className="two-col"><section className="panel"><h2>Withdrawal request</h2><p>Available Total Money: <strong>{money(totalMoney)}</strong></p><form onSubmit={submit}>
      <div className="input-wrap"><label htmlFor="withdraw-amount">Amount to withdraw (₹)</label><input id="withdraw-amount" type="number" required min="70" max={Math.min(1000, totalMoney)} step="1" value={amount} onChange={e => setAmount(e.target.value)} placeholder="70–1,000" /><span className="helper">Minimum ₹70 · Maximum ₹1,000</span></div>
      <div className="input-wrap"><label htmlFor="withdraw-upi">Your UPI ID</label><input id="withdraw-upi" required minLength={5} maxLength={128} value={upiId} onChange={e => setUpiId(e.target.value)} placeholder="name@bank" /></div>
      <div className="notice" style={{ margin: '18px 0' }}><div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Requested amount</span><strong>{money(numeric)}</strong></div><div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}><span>5% tax</span><strong>−{money(tax)}</strong></div><div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, borderTop: '1px solid #dedbcf', paddingTop: 10 }}><strong>Net payout</strong><strong>{money(payout)}</strong></div></div>
      {create.isError && <div className="error-text" role="alert">{safeError(create.error)}</div>}<button className="btn btn-primary" type="submit" disabled={create.isPending || numeric < 70 || numeric > 1000 || numeric > totalMoney} style={{ width: '100%' }}>{create.isPending ? 'Submitting…' : 'Request withdrawal'}</button>
    </form>{sent && <div className="success-box" role="status">Withdrawal request submitted.</div>}</section><aside className="panel"><div className="eyebrow">Tax, up front</div><h2 style={{ marginTop: 9 }}>Know your net.</h2><p>A 5% tax is applied to each cashout; the displayed net is the payout amount.</p><div className="notice green"><strong>Example</strong><br />Withdraw ₹100 → ₹5 tax → <strong>₹95 net payout</strong></div><div style={{ marginTop: 22, display: 'flex', gap: 12, alignItems: 'center', color: '#16805e' }}><ShieldCheck size={20} /><span style={{ fontSize: 11, lineHeight: 1.5 }}>Request status updates after manual processing.</span></div></aside></div>
  </main></AppFrame>;
}

function RoomPage({ user }: { user: { displayName: string } }) {
  const { roomId = '' } = useParams<{ roomId: string }>();
  const client = useQueryClient(); const [, setLocation] = useLocation(); const [score, setScore] = useState(0); const [submitted, setSubmitted] = useState(false);
  const queryKey = getGetRoomQueryKey(roomId);
  const query = useGetRoom(roomId, { query: { queryKey, enabled: Boolean(roomId), refetchInterval: state => state.state.data?.status === 'waiting' || state.state.data?.status === 'active' ? 2500 : false } });
  const leave = useLeaveRoom(); const submitScore = useSubmitRoomScore();
  const room = query.data as Room | undefined;
  const isFull = Boolean(room && room.players.length >= room.requiredSlots);
  const canPlay = Boolean(room && room.status === 'active' && isFull);
  const submit = () => { if (!room || !canPlay || submitted) return; submitScore.mutate({ roomId: room.id, data: { score } }, { onSuccess: () => { setSubmitted(true); client.invalidateQueries({ queryKey }); client.invalidateQueries({ queryKey: getGetLobbyQueryKey() }); } }); };
  const onLeave = () => { if (!room) return; leave.mutate({ roomId: room.id }, { onSuccess: () => { client.invalidateQueries({ queryKey }); client.invalidateQueries({ queryKey: getGetLobbyQueryKey() }); setLocation('/'); } }); };
  const [cells, setCells] = useState<(string | null)[]>(Array(9).fill(null));
  const gameId = room?.gameId ?? ''; const gameIsTic = gameId.includes('tic'); const gameIsSnake = gameId.includes('snake');
  if (query.isLoading) return <AppFrame user={user}><LoadingState /></AppFrame>;
  if (query.isError || !room) return <AppFrame user={user}><main className="page"><QueryError retry={() => query.refetch()} message={query.isError ? safeError(query.error) : 'This room could not be found.'} /></main></AppFrame>;
  const scoreClick = () => setScore(value => value + 1);
  return <AppFrame user={user}><main className="page room-shell"><div className="subpage-head"><div><div className="eyebrow">Room / {room.gameName}</div><h1>{room.status === 'finished' ? 'Match complete.' : room.gameName}</h1><p>Room entry {money(room.entryFee)} · winner receives {money(room.prize)} · {room.requiredSlots} real players</p></div><Link href="/" className="btn btn-soft btn-small"><ArrowLeft size={13} />Lobby</Link></div>
    {room.status === 'finished' ? <section className="panel queue-panel"><Trophy size={30} color="#16805e" /><div className="eyebrow" style={{ marginTop: 14 }}>Final result</div><h2 style={{ marginTop: 8 }}>{room.winnerName ? `${room.winnerName} wins` : 'Match settled'}</h2><p>The result has been recorded for this real-player room.</p><Link href="/" className="btn btn-primary">Back to lobby</Link></section> :
    !canPlay ? <section className="panel queue-panel"><div className="queue-orbit" /><div className="eyebrow">Real-player matchmaking</div><h2 style={{ marginTop: 8 }}>Searching for players...</h2><p>This match starts only after every player slot is filled. No bots, no early starts.</p><div className="slots">{Array.from({ length: room.requiredSlots }, (_, i) => <span key={i} className={`slot${room.players[i] ? ' filled' : ''}`}>{room.players[i] ? room.players[i].displayName.slice(0, 1).toUpperCase() : i + 1}</span>)}</div><p className="helper">{room.players.length} of {room.requiredSlots} players joined</p>
      {room.status === 'waiting' && <button className="btn btn-soft" onClick={onLeave} disabled={leave.isPending}>{leave.isPending ? 'Leaving…' : 'Leave queue'}</button>}
      {(leave.isError || query.isError) && <div className="error-text">{leave.isError ? safeError(leave.error) : safeError(query.error)}</div>}
    </section> :
    <section className="play-board"><div className="play-top"><div><div className="eyebrow">{room.players.length} players present</div><div className="play-score">{room.userSubmittedScore || submitted ? 'Score submitted' : `Your score · ${score}`}</div></div><Status value={room.status} /></div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', margin: '20px auto' }}>
        {gameIsTic ? <div><div className="ttt-grid">{cells.map((cell, index) => <button key={index} className="ttt-cell" disabled={Boolean(cell) || submitted} onClick={() => { const next = [...cells]; next[index] = 'X'; setCells(next); setScore(next.filter(Boolean).length); }} aria-label={`Square ${index + 1}`}>{cell}</button>)}</div><p style={{ textAlign: 'center' }}>Select your move, then submit your score to the room.</p></div> :
        gameIsSnake ? <div><div className="snake-grid" aria-label="Snake practice board">{Array.from({ length: 100 }, (_, i) => <div key={i} className={`snake-cell${i < score ? ' body' : ''}${i === Math.min(99, score + 10) ? ' food' : ''}`} />)}</div><div className="direction-pad"><span /><button onClick={scoreClick} disabled={submitted} aria-label="Move up">↑</button><span /><button onClick={scoreClick} disabled={submitted} aria-label="Move left">←</button><button onClick={scoreClick} disabled={submitted} aria-label="Move down">↓</button><button onClick={scoreClick} disabled={submitted} aria-label="Move right">→</button></div><p style={{ textAlign: 'center' }}>Practice the controls, then submit your score.</p></div> :
        <div style={{ textAlign: 'center' }}><button className="click-target" aria-label="Tap to score" disabled={submitted} onClick={scoreClick}>{submitted ? 'SENT' : 'TAP'}</button><p>Tap to build your score, then submit it.</p></div>}
      </div>
      {submitScore.isError && <div className="error-text" role="alert">{safeError(submitScore.error)}</div>}
      <div style={{ textAlign: 'center' }}><button className="btn btn-primary" onClick={submit} disabled={submitScore.isPending || submitted || room.userSubmittedScore}>{submitScore.isPending ? 'Submitting…' : submitted || room.userSubmittedScore ? 'Score submitted' : 'Submit score'}</button></div>
    </section>}
  </main></AppFrame>;
}

function QrCode({ upiId, amount }: { upiId: string; amount: number }) {
  const [src, setSrc] = useState('');
  const payload = `upi://pay?pa=${encodeURIComponent(upiId)}&am=${encodeURIComponent(String(amount))}&cu=INR&tn=AppPayout`;
  useEffect(() => { let live = true; QRCode.toDataURL(payload, { width: 160, margin: 1, errorCorrectionLevel: 'M' }).then(data => { if (live) setSrc(data); }).catch(() => { if (live) setSrc(''); }); return () => { live = false; }; }, [payload]);
  return src ? <img className="qr" src={src} alt={`UPI payout QR for ${upiId}, ${money(amount)}`} /> : <div className="qr" aria-label="Generating UPI QR code" />;
}

function AdminRequestTable({ title, rows, kind, onDecision, onPaid, busyId }: {
  title: string; rows: Transaction[]; kind: 'deposit' | 'withdrawal'; onDecision: (id: string, decision: 'approve' | 'reject') => void; onPaid: (id: string) => void; busyId: string;
}) {
  return <section className="panel admin-block"><h2>{title}</h2>{rows.length ? <>
    <div className="admin-row admin-row-head"><span>Player</span><span>Amount</span><span>Details / payout QR</span><span>Status</span><span>Operations</span></div>
    {rows.map(row => <div className="admin-row" key={row.id} data-testid={`admin-row-${row.id}`}>
      <span><strong>{row.userName}</strong><br /><span className="helper">{dateLabel(row.createdAt)}</span></span><span>{money(row.amount)}</span>
      <span>{kind === 'deposit' ? <>{`UTR ${row.utr || '—'}`}{row.screenshotDataUrl && <><br /><a href={row.screenshotDataUrl} target="_blank" rel="noreferrer" style={{ color: '#16805e', fontWeight: 800 }}>View proof</a></>}</> :
        <><strong>{row.upiId || '—'}</strong><br /><span className="helper">Tax {money(row.tax)} · net {money(row.payout)}</span><br />{row.upiId && <QrCode upiId={row.upiId} amount={row.payout} />}</>}</span>
      <Status value={row.status} /><span className="admin-buttons">{row.status === 'pending' && (kind === 'deposit' ? <><button className="btn btn-primary btn-small" disabled={busyId === row.id} onClick={() => onDecision(row.id, 'approve')}>Approve</button><button className="btn btn-danger btn-small" disabled={busyId === row.id} onClick={() => onDecision(row.id, 'reject')}>Reject</button></> : <button className="btn btn-primary btn-small" disabled={busyId === row.id} onClick={() => onPaid(row.id)}>Mark paid</button>)}</span>
    </div>)}
  </> : <div className="empty">No requests to show yet.</div>}</section>;
}

function AdminPage({ user, dashboard, retry }: { user: { displayName: string }; dashboard: AdminDashboard; retry: () => void }) {
  const decide = useDecideDeposit(); const complete = useCompleteWithdrawal(); const updateSettings = useUpdateAdminSettings(); const client = useQueryClient();
  const [busyId, setBusyId] = useState(''); const [error, setError] = useState(''); const [saved, setSaved] = useState(false);
  const [adminUpiId, setAdminUpiId] = useState(dashboard.settings.adminUpiId); const [adminQrCodeUrl, setAdminQrCodeUrl] = useState(dashboard.settings.adminQrCodeUrl);
  useEffect(() => { setAdminUpiId(dashboard.settings.adminUpiId); setAdminQrCodeUrl(dashboard.settings.adminQrCodeUrl); }, [dashboard.settings.adminUpiId, dashboard.settings.adminQrCodeUrl]);
  const refresh = () => { client.invalidateQueries({ queryKey: getGetAdminDashboardQueryKey() }); client.invalidateQueries({ queryKey: getGetLobbyQueryKey() }); setBusyId(''); };
  const onDecision = (id: string, decision: 'approve' | 'reject') => { setBusyId(id); setError(''); decide.mutate({ transactionId: id, data: { decision } }, { onSuccess: refresh, onError: err => { setBusyId(''); setError(safeError(err)); } }); };
  const onPaid = (id: string) => { setBusyId(id); setError(''); complete.mutate({ transactionId: id }, { onSuccess: refresh, onError: err => { setBusyId(''); setError(safeError(err)); } }); };
  const saveSettings = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSaved(false); updateSettings.mutate({ data: { adminUpiId, adminQrCodeUrl } }, { onSuccess: () => { setSaved(true); client.invalidateQueries({ queryKey: getGetAdminDashboardQueryKey() }); client.invalidateQueries({ queryKey: getGetLobbyQueryKey() }); } }); };
  const stats = [
    ['2-player · ₹20 rake', dashboard.rake20Player2], ['2-player · ₹50 rake', dashboard.rake50Player2],
    ['4-player · ₹20 rake', dashboard.rake20Player4], ['4-player · ₹50 rake', dashboard.rake50Player4],
    ['Withdrawal tax', dashboard.totalWithdrawalTax], ['Pending requests', dashboard.pendingCount],
  ];
  return <AppFrame user={user}><main className="page"><div className="subpage-head"><div><div className="eyebrow">Operations / manual review</div><h1>Admin desk</h1><p>Review wallet requests, review revenue by room format, and maintain payment settings.</p></div><button className="btn btn-soft btn-small" onClick={retry}><RefreshCw size={13} />Refresh</button></div>
    <div className="admin-stats">{stats.map(([label, value]) => <div className="stat-box" key={label}><span>{label}</span><strong>{typeof value === 'number' && label !== 'Pending requests' ? money(value) : value}</strong></div>)}</div>
    {error && <div className="error-text" role="alert">{error}</div>}
    <AdminRequestTable title="Deposit requests" rows={dashboard.deposits} kind="deposit" onDecision={onDecision} onPaid={onPaid} busyId={busyId} />
    <AdminRequestTable title="Withdrawal requests" rows={dashboard.withdrawals} kind="withdrawal" onDecision={onDecision} onPaid={onPaid} busyId={busyId} />
    <section className="panel"><div className="eyebrow">System settings</div><h2 style={{ marginTop: 8 }}>Payment destination</h2><p>These details are shown on the deposit screen.</p><form onSubmit={saveSettings}>
      <div className="input-wrap"><label htmlFor="admin-upi">Admin UPI ID</label><input id="admin-upi" required minLength={5} maxLength={128} value={adminUpiId} onChange={e => setAdminUpiId(e.target.value)} /></div>
      <div className="input-wrap"><label htmlFor="admin-qr">Admin QR code URL or data URL</label><input id="admin-qr" required minLength={1} maxLength={2048} value={adminQrCodeUrl} onChange={e => setAdminQrCodeUrl(e.target.value)} /></div>
      <button className="btn btn-primary" type="submit" disabled={updateSettings.isPending}>{updateSettings.isPending ? 'Saving…' : 'Save payment settings'}</button>{updateSettings.isError && <div className="error-text">{safeError(updateSettings.error)}</div>}{saved && <div className="success-box">Payment settings saved.</div>}
    </form></section>
  </main></AppFrame>;
}

function NotFoundPage() { return <AppFrame user={null}><main className="page"><section className="panel" style={{ margin: '70px auto', textAlign: 'center', maxWidth: 500 }}><div className="eyebrow">404 / no match</div><h1 className="font-display">This page is out of play.</h1><p>The page you are looking for does not exist.</p><Link href="/" className="btn btn-primary">Back to lobby</Link></section></main></AppFrame>; }

function RoutedApp() {
  const session = useGetSession(); const user = session.data?.user ?? null; const signedIn = Boolean(user); const [, setLocation] = useLocation(); const [path] = useLocation();
  const lobby = useGetLobby({ query: { enabled: signedIn, queryKey: getGetLobbyQueryKey(), retry: false } });
  const admin = useGetAdminDashboard({ query: { enabled: user?.role === 'admin', queryKey: getGetAdminDashboardQueryKey(), retry: false } });
  if (session.isLoading) return <AppFrame user={null}><LoadingState /></AppFrame>;
  if (!signedIn) return <AuthScreen onAuth={() => setLocation('/')} />;
  if (path === '/admin' && user?.role !== 'admin') return <AppFrame user={user}><main className="page"><section className="panel" style={{ margin: '50px auto', maxWidth: 520 }}><div className="eyebrow">Restricted area</div><h2>Admin access only</h2><p>This operations desk is available to admin accounts.</p><Link href="/" className="btn btn-primary">Return to lobby</Link></section></main></AppFrame>;
  if (path === '/admin') {
    if (admin.isLoading || !admin.data) return <AppFrame user={user}><LoadingState /></AppFrame>;
    if (admin.isError) return <AppFrame user={user}><main className="page"><QueryError retry={() => admin.refetch()} message={safeError(admin.error)} /></main></AppFrame>;
    return <AdminPage user={user!} dashboard={admin.data} retry={() => admin.refetch()} />;
  }
  if (lobby.isLoading || !lobby.data) return <AppFrame user={user}><LoadingState /></AppFrame>;
  if (lobby.isError) return <AppFrame user={user}><main className="page"><QueryError retry={() => lobby.refetch()} message={safeError(lobby.error)} /></main></AppFrame>;
  const data = lobby.data;
  return <Switch>
    <Route path="/"><Lobby user={data.user} wallet={data.wallet} games={data.games} transactions={data.transactions} activeRoom={data.activeRoom} retry={() => lobby.refetch()} /></Route>
    <Route path="/add-cash"><DepositPage user={data.user} totalMoney={data.wallet.totalMoney} settings={data.settings} /></Route>
    <Route path="/withdraw"><WithdrawalPage user={data.user} totalMoney={data.wallet.totalMoney} /></Route>
    <Route path="/rooms/:roomId"><RoomPage user={data.user} /></Route>
    <Route component={NotFoundPage} />
  </Switch>;
}

function App() { return <QueryClientProvider client={queryClient}><RoutedApp /></QueryClientProvider>; }

export default App;
