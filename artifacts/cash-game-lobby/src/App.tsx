import { useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, ArrowRight, ArrowUpRight, Check, ChevronRight, LogOut, RefreshCw, ShieldCheck,
  Sparkles, Trophy, Wallet as WalletIcon,
  X,
} from 'lucide-react';
import {
  getGetAdminDashboardQueryKey, getGetLobbyQueryKey, getGetSessionQueryKey,
  useCompleteWithdrawal, useCreateDeposit, useCreateWithdrawal, useDecideDeposit,
  useFinishMatch, useGetAdminDashboard, useGetLobby, useGetSession, useSignIn,
  useSignOut, useSignUp, useStartMatch,
} from '@workspace/api-client-react';
import type { AdminDashboard, Game, Match, Transaction } from '@workspace/api-client-react';
import { Link, Route, Switch, useLocation, useParams } from 'wouter';
import type { FormEvent, ReactNode } from 'react';

const queryClient = new QueryClient();
const money = (amount = 0) => `₹${Number(amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const dateLabel = (date: string) => new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const safeError = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';

function AppFrame({ children, user }: { children: ReactNode; user?: { displayName: string; role: string } | null }) {
  const signOut = useSignOut();
  const client = useQueryClient();
  const [, setLocation] = useLocation();
  const nav = [
    { label: 'Lobby', href: '/' },
    { label: 'Add cash', href: '/add-cash' },
    { label: 'Withdraw', href: '/withdraw' },
    ...(user?.role === 'admin' ? [{ label: 'Admin', href: '/admin' }] : []),
  ];
  const logout = () => signOut.mutate(undefined, { onSuccess: () => {
    client.invalidateQueries({ queryKey: getGetSessionQueryKey() });
    client.invalidateQueries({ queryKey: getGetLobbyQueryKey() });
    setLocation('/');
  } });
  return <div className="shell">
    <header className="topbar">
      <Link href="/" className="brand"><span className="brand-mark">K</span><span>KHELO<span style={{ color: '#16805e' }}>.</span></span></Link>
      <nav className="topnav" aria-label="Main navigation">
        {nav.map(item => <Link key={item.href} href={item.href} className={location.pathname === item.href ? 'active' : ''}>{item.label}</Link>)}
      </nav>
      {user ? <div className="account"><span className="avatar">{user.displayName.slice(0, 1).toUpperCase()}</span><span>{user.displayName}</span><button className="btn btn-soft btn-small" onClick={logout} disabled={signOut.isPending} aria-label="Sign out"><LogOut size={14} /></button></div> :
        <Link href="/" className="btn btn-primary btn-small">Sign in</Link>}
    </header>
    {user && <nav className="mobile-menu" aria-label="Mobile navigation">{nav.map(item => <Link key={item.href} href={item.href} className={location.pathname === item.href ? 'active' : ''}>{item.label}</Link>)}</nav>}
    {children}
  </div>;
}

function AuthScreen({ onAuth }: { onAuth: () => void }) {
  const signup = useSignUp();
  const signin = useSignIn();
  const client = useQueryClient();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const mutation = mode === 'signin' ? signin : signup;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const onSuccess = () => {
      client.invalidateQueries({ queryKey: getGetSessionQueryKey() });
      client.invalidateQueries({ queryKey: getGetLobbyQueryKey() });
      onAuth();
    };
    if (mode === 'signin') signin.mutate({ data: { email, password } }, { onSuccess });
    else signup.mutate({ data: { email, displayName: name, password } }, { onSuccess });
  };
  return <AppFrame user={null}><main className="auth-wrap">
    <section className="auth-card">
      <div className="eyebrow">Your next match is one tap away</div>
      <h1>{mode === 'signin' ? 'Back in the game.' : 'Make your move.'}</h1>
      <p>Quick skill matches. Clear balances. Every rupee accounted for.</p>
      <form onSubmit={submit}>
        {mode === 'signup' && <div className="input-wrap"><label htmlFor="display-name">Display name</label><input id="display-name" data-testid="input-display-name" required minLength={2} maxLength={40} value={name} onChange={e => setName(e.target.value)} placeholder="What should we call you?" /></div>}
        <div className="input-wrap"><label htmlFor="email">Email address</label><input id="email" data-testid="input-email" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></div>
        <div className="input-wrap"><label htmlFor="password">Password</label><input id="password" data-testid="input-password" type="password" required minLength={mode === 'signup' ? 10 : 1} value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === 'signup' ? 'At least 10 characters' : 'Your password'} /></div>
        {mutation.isError && <div className="error-text" role="alert">{safeError(mutation.error)}</div>}
        <button className="btn btn-primary" data-testid="button-auth-submit" type="submit" disabled={mutation.isPending} style={{ width: '100%', marginTop: 8 }}>{mutation.isPending ? 'One moment…' : mode === 'signin' ? 'Sign in' : 'Create account'}</button>
      </form>
      <button className="auth-switch" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); signin.reset(); signup.reset(); }}>
        {mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}
      </button>
    </section>
  </main></AppFrame>;
}

function LoadingState() {
  return <main className="loading-page"><div className="skeleton" /><div style={{ height: 20 }} /><div className="skeleton" style={{ height: 130 }} /></main>;
}

function QueryError({ retry, message }: { retry: () => void; message: string }) {
  return <div className="panel" style={{ maxWidth: 600, margin: '60px auto', textAlign: 'center' }}><h2>We hit a pause.</h2><p>{message}</p><button className="btn btn-primary" onClick={retry}><RefreshCw size={14} style={{ verticalAlign: 'middle', marginRight: 7 }} />Try again</button></div>;
}

function Status({ value }: { value: string }) { return <span className={`status ${value}`}>{value}</span>; }

function WalletBlock({ wallet }: { wallet: { depositBalance: number; winningBalance: number; bonusBalance: number } }) {
  const items = [
    { label: 'Deposit balance', value: wallet.depositBalance, icon: <WalletIcon size={17} />, foot: 'Cash added to your account', href: '/add-cash' },
    { label: 'Winning balance', value: wallet.winningBalance, icon: <Trophy size={17} />, foot: 'Available to withdraw', href: '/withdraw' },
    { label: 'Bonus balance', value: wallet.bonusBalance, icon: <Sparkles size={17} />, foot: 'Used toward match entry', href: null },
  ];
  return <div className="wallet-grid">{items.map(item => <div className="wallet-card" key={item.label} data-testid={`wallet-${item.label.toLowerCase().replace(/ /g, '-')}`}>
    <div className="wallet-icon">{item.icon}</div><div className="wallet-name">{item.label}</div><div className="wallet-value">{money(item.value)}</div><div className="wallet-foot">{item.foot}</div>
    {item.href && <Link href={item.href} className="action-link">{item.href === '/add-cash' ? 'Add cash' : 'Withdraw'} <ChevronRight size={12} style={{ verticalAlign: 'middle' }} /></Link>}
  </div>)}</div>;
}

function GameCard({ game }: { game: Game }) {
  const slug = game.id.toLowerCase();
  const artClass = slug.includes('snake') ? 'snake' : slug.includes('click') ? 'clicker' : 'tic';
  const symbol = artClass === 'snake' ? 'SNAKE' : artClass === 'clicker' ? 'TAP!' : 'X / O';
  return <Link href={`/games/${game.id}`} className="game-card" data-testid={`card-game-${game.id}`}>
    <div className={`game-art ${artClass}`}><span className="game-symbol">{symbol}</span></div>
    <div className="game-details"><h3>{game.name}</h3><p>{game.description}</p>
      <div className="game-meta"><span>{game.players}</span><span>{money(game.entryFee)} entry</span><span style={{ color: '#16805e', fontWeight: 700 }}>{money(game.prize)} prize</span></div>
    </div>
  </Link>;
}

function ActivityTable({ transactions }: { transactions: Transaction[] }) {
  if (!transactions.length) return <div className="activity"><div className="empty">Your wallet activity will show up here.</div></div>;
  return <div className="activity">
    <div className="activity-row activity-head"><span>Type</span><span>Reference</span><span>Amount</span><span>Status</span></div>
    {transactions.slice(0, 5).map(item => <div className="activity-row" key={item.id} data-testid={`row-transaction-${item.id}`}>
      <span style={{ textTransform: 'capitalize', fontWeight: 800 }}>{item.type}</span><span>{dateLabel(item.createdAt)}</span><span>{money(item.amount)}</span><Status value={item.status} />
    </div>)}
  </div>;
}

function Lobby({ user, wallet, games, transactions, matches, retry }: {
  user: { displayName: string }; wallet: { depositBalance: number; winningBalance: number; bonusBalance: number };
  games: Game[]; transactions: Transaction[]; matches: Match[]; retry: () => void;
}) {
  return <AppFrame user={user}><main className="page">
    <section className="hero">
      <div className="hero-copy"><div className="eyebrow" style={{ color: '#a9c4b3' }}>Khelo skill club / match 01</div>
        <h1>Good game.<br />Great instincts.</h1><p>Pick a quick challenge, bring your focus, and play for a ₹108 prize. Your balances stay clear, always.</p>
        <a className="btn btn-yellow" href="#games">Find your game <ArrowRight size={15} style={{ verticalAlign: 'middle', marginLeft: 8 }} /></a>
      </div>
      <div className="hero-art" aria-hidden="true"><div className="hero-token">₹</div><div className="hero-label">₹54 cash + ₹6 bonus</div></div>
    </section>
    <section><div className="section-head"><div><div className="eyebrow">Your money, in its place</div><h2>Three balances. No guesswork.</h2></div><Link href="/add-cash" className="btn btn-soft btn-small">Add cash <ArrowUpRight size={13} style={{ verticalAlign: 'middle', marginLeft: 4 }} /></Link></div>
      <WalletBlock wallet={wallet} /></section>
    <section id="games"><div className="section-head"><div><div className="eyebrow">Pick a quick match</div><h2>Play your kind of game.</h2></div><span className="eyebrow">{games.length} skill games</span></div>
      {games.length ? <div className="games-grid">{games.map(game => <GameCard key={game.id} game={game} />)}</div> : <div className="panel empty">Games are taking a short break. <button onClick={retry} className="auth-switch">Reload lobby</button></div>}
    </section>
    <section><div className="section-head"><div><div className="eyebrow">Recent matches</div><h2>Last played</h2></div></div>
      {matches.length ? <div className="activity">{matches.slice(0, 4).map(match => <div className="activity-row" key={match.id} data-testid={`row-match-${match.id}`}><span style={{ fontWeight: 800 }}>{match.gameName}</span><span>vs {match.opponentName}</span><span>{money(match.entryFee)} / {money(match.prize)}</span><Status value={match.status} /></div>)}</div> : <div className="panel empty">No matches yet. Choose a game above to get started.</div>}
    </section>
    <section><div className="section-head"><div><div className="eyebrow">Wallet ledger</div><h2>Recent activity</h2></div></div><ActivityTable transactions={transactions} /></section>
    <div className="notice" style={{ marginTop: 23 }}><strong>Match maths, plainly.</strong> A ₹60 entry uses exactly ₹54 from your deposit balance and ₹6 from bonus. The ₹108 prize goes straight to winning balance.</div>
  </main></AppFrame>;
}

function DepositPage({ user, balance }: { user: { displayName: string }; balance: number }) {
  const create = useCreateDeposit();
  const client = useQueryClient();
  const [amount, setAmount] = useState('');
  const [utr, setUtr] = useState('');
  const [fileData, setFileData] = useState('');
  const [fileName, setFileName] = useState('');
  const [sent, setSent] = useState(false);
  const [fileError, setFileError] = useState('');
  const onFile = (file?: File) => {
    if (!file) return;
    if (file.size > 2_000_000) { setFileError('Image must be smaller than 2 MB.'); return; }
    setFileError('');
    const reader = new FileReader();
    reader.onload = () => { setFileData(String(reader.result || '')); setFileName(file.name); };
    reader.readAsDataURL(file);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSent(false);
    create.mutate({ data: { amount: Number(amount), utr, screenshotDataUrl: fileData } }, {
      onSuccess: () => { setSent(true); setAmount(''); setUtr(''); setFileData(''); setFileName(''); client.invalidateQueries({ queryKey: getGetLobbyQueryKey() }); },
    });
  };
  return <AppFrame user={user}><main className="page"><div className="subpage-head"><div><div className="eyebrow">Wallet / deposit</div><h1>Add cash</h1><p>Send a UPI payment, then share the UTR and payment screenshot. Deposits are manually reviewed before your balance changes.</p></div><Link href="/" className="btn btn-soft btn-small"><ArrowLeft size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} />Lobby</Link></div>
    <div className="two-col"><section className="panel"><h2>Request a deposit</h2><p>Your current deposit balance: <strong>{money(balance)}</strong></p>
      <div className="notice green"><strong>Pay to UPI</strong><br /><span className="font-mono">YOUR_UPI_ID@HERE</span><br />Use your UPI app to send the amount, then enter the matching details below.</div>
      <form onSubmit={submit}>
        <div className="input-wrap"><label htmlFor="deposit-amount">Amount (₹)</label><input id="deposit-amount" data-testid="input-deposit-amount" type="number" min="1" max="100000" required value={amount} onChange={e => setAmount(e.target.value)} placeholder="Enter amount" /></div>
        <div className="input-wrap"><label htmlFor="utr">UPI transaction reference (UTR)</label><input id="utr" data-testid="input-deposit-utr" required minLength={6} maxLength={64} value={utr} onChange={e => setUtr(e.target.value)} placeholder="12-digit transaction reference" /></div>
        <div className="input-wrap"><label htmlFor="payment-proof">Payment screenshot</label><input id="payment-proof" data-testid="input-deposit-screenshot" type="file" accept="image/*" required onChange={e => onFile(e.target.files?.[0])} /><span className="helper">{fileName || 'PNG or JPG, up to 2 MB'}</span></div>
        {(fileError || create.isError) && <div className="error-text" role="alert">{fileError || safeError(create.error)}</div>}
        <button className="btn btn-primary" type="submit" data-testid="button-submit-deposit" disabled={create.isPending || !fileData} style={{ width: '100%' }}>{create.isPending ? 'Sending request…' : 'Submit deposit request'}</button>
      </form>
      {sent && <div className="success-box" role="status">Deposit request sent. It will appear in your activity while our team reviews it.</div>}
    </section>
    <aside className="panel"><div className="eyebrow">What happens next</div><h2 style={{ marginTop: 9 }}>A clear, manual check.</h2><p>We match your reference and screenshot to the payment. Once approved, the deposit amount is added to your deposit balance.</p>
      <div style={{ display: 'grid', gap: 15, marginTop: 21 }}>{[['01', 'Pay via UPI', 'Send to YOUR_UPI_ID@HERE'], ['02', 'Share the proof', 'Enter UTR and upload the receipt'], ['03', 'Wait for review', 'Manual review before funds appear']].map(item => <div key={item[0]} style={{ display: 'flex', gap: 13 }}><span className="font-mono" style={{ color: '#16805e' }}>{item[0]}</span><div><strong style={{ fontSize: 12 }}>{item[1]}</strong><div className="helper" style={{ marginTop: 4 }}>{item[2]}</div></div></div>)}</div>
    </aside></div>
  </main></AppFrame>;
}

function WithdrawalPage({ user, balance }: { user: { displayName: string }; balance: number }) {
  const create = useCreateWithdrawal();
  const client = useQueryClient();
  const [amount, setAmount] = useState('');
  const [upiId, setUpiId] = useState('');
  const [sent, setSent] = useState(false);
  const numeric = Number(amount) || 0;
  const tax = Math.round(numeric * 5) / 100;
  const payout = Math.round((numeric - tax) * 100) / 100;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSent(false);
    create.mutate({ data: { amount: numeric, upiId } }, { onSuccess: () => {
      setSent(true); setAmount(''); setUpiId(''); client.invalidateQueries({ queryKey: getGetLobbyQueryKey() });
    } });
  };
  return <AppFrame user={user}><main className="page"><div className="subpage-head"><div><div className="eyebrow">Wallet / payout</div><h1>Withdraw winnings</h1><p>Request a payout to your UPI ID. Your winning balance is deducted immediately when you submit, while the payout is manually processed.</p></div><Link href="/" className="btn btn-soft btn-small"><ArrowLeft size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} />Lobby</Link></div>
    <div className="two-col"><section className="panel"><h2>Withdrawal request</h2><p>Available winning balance: <strong>{money(balance)}</strong></p>
      <form onSubmit={submit}>
        <div className="input-wrap"><label htmlFor="withdraw-amount">Amount to withdraw (₹)</label><input id="withdraw-amount" data-testid="input-withdraw-amount" type="number" required min="1" max={Math.min(100000, balance)} value={amount} onChange={e => setAmount(e.target.value)} placeholder="Enter an amount" /></div>
        <div className="input-wrap"><label htmlFor="withdraw-upi">Your UPI ID</label><input id="withdraw-upi" data-testid="input-withdraw-upi" required minLength={5} maxLength={128} value={upiId} onChange={e => setUpiId(e.target.value)} placeholder="name@bank" /></div>
        <div className="notice" style={{ margin: '18px 0' }}><div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Requested amount</span><strong>{money(numeric)}</strong></div><div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}><span>5% processing tax</span><strong>−{money(tax)}</strong></div><div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, borderTop: '1px solid #dedbcf', paddingTop: 10 }}><strong>Net payout</strong><strong>{money(payout)}</strong></div></div>
        {create.isError && <div className="error-text" role="alert">{safeError(create.error)}</div>}
        <button className="btn btn-primary" data-testid="button-submit-withdrawal" type="submit" disabled={create.isPending || numeric < 1 || numeric > balance} style={{ width: '100%' }}>{create.isPending ? 'Submitting…' : 'Request withdrawal'}</button>
      </form>
      {sent && <div className="success-box" role="status">Withdrawal request submitted. The requested amount has been deducted from your winning balance.</div>}
    </section><aside className="panel"><div className="eyebrow">The payout, step by step</div><h2 style={{ marginTop: 9 }}>Net amount up front.</h2><p>We show the 5% tax before you submit, so you know the exact payout. A team member then marks the transfer paid.</p><div className="notice green"><strong>Example</strong><br />Withdraw ₹100 → ₹5 tax → <strong>₹95 net payout</strong></div><div style={{ marginTop: 22, display: 'flex', gap: 12, alignItems: 'center', color: '#16805e' }}><ShieldCheck size={20} /><span style={{ fontSize: 11, lineHeight: 1.5 }}>Your request status will update after manual processing.</span></div></aside></div>
  </main></AppFrame>;
}

function GamePage({ user, games, wallet, retry }: { user: { displayName: string }; games: Game[]; wallet: { depositBalance: number; winningBalance: number; bonusBalance: number }; retry: () => void }) {
  const params = useParams<{ gameId: string }>();
  const game = games.find(item => item.id === params.gameId);
  const start = useStartMatch();
  const finish = useFinishMatch();
  const client = useQueryClient();
  const [match, setMatch] = useState<Match | null>(null);
  const [score, setScore] = useState(0);
  const [cells, setCells] = useState<(string | null)[]>(Array(9).fill(null));
  const [snake, setSnake] = useState([{ x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }]);
  const [food, setFood] = useState({ x: 7, y: 5 });
  const [finished, setFinished] = useState(false);
  const [toast, setToast] = useState('');
  const snakeGame = game?.id.includes('snake');
  const clickGame = game?.id.includes('clicker');
  const ticGame = game?.id.includes('tic');
  const resetGame = () => { setScore(0); setCells(Array(9).fill(null)); setSnake([{ x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }]); setFood({ x: 7, y: 5 }); setFinished(false); };
  const finishResult = (result: 'won' | 'lost') => {
    if (!match || finished) return;
    setFinished(true);
    finish.mutate({ matchId: match.id, data: { result } }, { onSuccess: () => {
      client.invalidateQueries({ queryKey: getGetLobbyQueryKey() });
      setToast(result === 'won' ? 'Match won. ₹108 prize added to winning balance.' : 'Match complete. Better luck next round.');
    } });
  };
  const begin = () => {
    if (!game) return;
    start.mutate({ data: { gameId: game.id as 'snake' | 'clicker' | 'tic-tac-toe' } }, { onSuccess: data => {
      setMatch(data); resetGame(); client.invalidateQueries({ queryKey: getGetLobbyQueryKey() });
    } });
  };
  const moveSnake = (dir: { x: number; y: number }) => {
    if (!match || finished) return;
    const head = snake[0];
    const next = { x: (head.x + dir.x + 10) % 10, y: (head.y + dir.y + 10) % 10 };
    const ate = next.x === food.x && next.y === food.y;
    const nextSnake = [next, ...snake.slice(0, ate ? undefined : -1)];
    setSnake(nextSnake);
    if (ate) {
      const nextScore = score + 1; setScore(nextScore);
      setFood({ x: (food.x + 3) % 10, y: (food.y + 4) % 10 });
      if (nextScore >= 5) finishResult('won');
    }
  };
  const ticWinner = (board: (string | null)[]) => {
    const wins = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    return wins.some(line => board[line[0]] && board[line[0]] === board[line[1]] && board[line[1]] === board[line[2]]);
  };
  const playTic = (index: number) => {
    if (cells[index] || !match || finished) return;
    const playerBoard = [...cells]; playerBoard[index] = 'X'; setCells(playerBoard);
    if (ticWinner(playerBoard)) { finishResult('won'); return; }
    if (playerBoard.every(Boolean)) { finishResult('lost'); return; }
    const opponentIndex = playerBoard.findIndex(cell => !cell);
    const opponentBoard = [...playerBoard]; opponentBoard[opponentIndex] = 'O'; setCells(opponentBoard);
    if (ticWinner(opponentBoard)) { finishResult('lost'); return; }
    if (opponentBoard.every(Boolean)) finishResult('lost');
  };
  if (!game) return <AppFrame user={user}><main className="page"><QueryError message="That game could not be found in the lobby." retry={retry} /></main></AppFrame>;
  const fundsEnough = wallet.depositBalance + wallet.bonusBalance >= 60 && wallet.depositBalance >= 54 && wallet.bonusBalance >= 6;
  return <AppFrame user={user}><main className="page game-shell">
    <div className="subpage-head"><div><div className="eyebrow">Skill match / {game.name}</div><h1>{game.name}</h1><p>{game.description}</p></div><Link href="/" className="btn btn-soft btn-small"><ArrowLeft size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} />Lobby</Link></div>
    <section className="play-board">
      {!match ? <div style={{ maxWidth: 500, margin: '12px auto', textAlign: 'center' }}>
        <div className={`game-art ${snakeGame ? 'snake' : clickGame ? 'clicker' : 'tic'}`} style={{ borderRadius: 16, height: 150, marginBottom: 25 }}><span className="game-symbol">{snakeGame ? 'SNAKE' : clickGame ? 'TAP!' : 'X / O'}</span></div>
        <div className="eyebrow">Entry breakdown</div><h2 style={{ font: '600 27px Space Grotesk', margin: '8px 0' }}>₹60 in. ₹108 to win.</h2>
        <p>Exactly ₹54 comes from deposit balance + ₹6 from bonus balance. Prize is credited to winning balance.</p>
        {!fundsEnough && <div className="notice" style={{ margin: '15px 0' }}>You need at least ₹54 deposit balance and ₹6 bonus balance for this match. <Link href="/add-cash" style={{ color: '#16805e', fontWeight: 800 }}>Add cash</Link></div>}
        {start.isError && <div className="error-text">{safeError(start.error)}</div>}
        <button className="btn btn-primary" disabled={!fundsEnough || start.isPending} onClick={begin} data-testid="button-start-match" style={{ minWidth: 190 }}>{start.isPending ? 'Finding your match…' : 'Pay ₹60 and play'}</button>
      </div> :
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div className="play-top"><div><div className="eyebrow">Match vs {match.opponentName}</div><div className="play-score">{snakeGame ? `Food ${score}/5` : clickGame ? `Taps ${score}/30` : 'Your turn · X'}</div></div><div className="status pending">Prize {money(match.prize)}</div></div>
        {snakeGame && <><div className="snake-grid" aria-label="Snake game board">{Array.from({ length: 100 }, (_, i) => { const x = i % 10; const y = Math.floor(i / 10); const isBody = snake.some(part => part.x === x && part.y === y); const isFood = food.x === x && food.y === y; return <div key={i} className={`snake-cell${isBody ? ' body' : ''}${isFood ? ' food' : ''}`} />; })}</div>
          <div className="direction-pad"><span /><button aria-label="Move up" onClick={() => moveSnake({ x: 0, y: -1 })}>↑</button><span /><button aria-label="Move left" onClick={() => moveSnake({ x: -1, y: 0 })}>←</button><button aria-label="Move down" onClick={() => moveSnake({ x: 0, y: 1 })}>↓</button><button aria-label="Move right" onClick={() => moveSnake({ x: 1, y: 0 })}>→</button></div><p style={{ textAlign: 'center' }}>Guide the snake to the gold dot. Collect five to win.</p></>}
        {clickGame && <><button className="click-target" aria-label="Tap to score" onClick={() => { const next = score + 1; setScore(next); if (next >= 30) finishResult('won'); }} data-testid="button-click-target">TAP</button><p style={{ textAlign: 'center' }}>Reach 30 taps to claim the match.</p></>}
        {ticGame && <><div className="ttt-grid">{cells.map((cell, index) => <button className="ttt-cell" key={index} onClick={() => playTic(index)} aria-label={`Square ${index + 1}${cell ? ` ${cell}` : ''}`} data-testid={`button-ttt-square-${index}`}>{cell}</button>)}</div><p style={{ textAlign: 'center' }}>You are X. Play against a local opponent.</p></>}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          <button className="btn btn-soft btn-small" onClick={() => finishResult('lost')} disabled={finish.isPending || finished}>End match</button>
          {finish.isPending && <span className="helper">Settling match…</span>}
        </div>
        {finished && <div className="success-box" style={{ textAlign: 'center' }}>Match result submitted. {finish.isError && <span className="error-text">{safeError(finish.error)}</span>}</div>}
      </div>}
    </section>
    {toast && <div role="status" className="toast-message"><Check size={14} style={{ verticalAlign: 'middle', marginRight: 8 }} />{toast}<button onClick={() => setToast('')} aria-label="Dismiss" style={{ background: 'none', color: 'inherit', border: 0, marginLeft: 10 }}><X size={13} /></button></div>}
  </main></AppFrame>;
}

function AdminTable({ title, rows, kind, pendingOnly, onDecision, onPaid, busyId }: {
  title: string; rows: Transaction[]; kind: 'deposit' | 'withdrawal'; pendingOnly?: boolean;
  onDecision: (id: string, decision: 'approve' | 'reject') => void; onPaid: (id: string) => void; busyId: string;
}) {
  const shown = pendingOnly ? rows.filter(row => row.status === 'pending') : rows;
  return <section className="panel admin-block"><h2>{title}</h2>{shown.length ? <>
    <div className="admin-row admin-row-head"><span>Player</span><span>Amount</span><span>Details</span><span>Status</span><span>Operations</span></div>
    {shown.map(row => <div className="admin-row" key={row.id} data-testid={`admin-row-${row.id}`}>
      <span><strong>{row.userName}</strong><br /><span className="helper">{dateLabel(row.createdAt)}</span></span>
      <span>{money(row.amount)}</span>
      <span>{kind === 'deposit' ? <>{`UTR ${row.utr || '—'}`}{row.screenshotDataUrl && <><br /><a href={row.screenshotDataUrl} target="_blank" rel="noreferrer" style={{ color: '#16805e', fontWeight: 800 }}>View proof</a></>}</> : `${row.upiId || '—'} · net ${money(row.payout ?? row.amount - (row.tax ?? 0))}`}</span>
      <Status value={row.status} />
      <span className="admin-buttons">{row.status === 'pending' && (kind === 'deposit' ? <>
        <button className="btn btn-primary btn-small" disabled={busyId === row.id} onClick={() => onDecision(row.id, 'approve')} data-testid={`button-approve-${row.id}`}>Approve</button>
        <button className="btn btn-danger btn-small" disabled={busyId === row.id} onClick={() => onDecision(row.id, 'reject')} data-testid={`button-reject-${row.id}`}>Reject</button>
      </> : <button className="btn btn-primary btn-small" disabled={busyId === row.id} onClick={() => onPaid(row.id)} data-testid={`button-paid-${row.id}`}>Mark paid</button>)}</span>
    </div>)}
  </> : <div className="empty">{pendingOnly ? 'No pending requests. The queue is clear.' : 'No requests to show yet.'}</div>}</section>;
}

function AdminPage({ user, dashboard, retry }: { user: { displayName: string }; dashboard: AdminDashboard; retry: () => void }) {
  const decide = useDecideDeposit();
  const complete = useCompleteWithdrawal();
  const client = useQueryClient();
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const done = (id: string) => { setBusyId(''); client.invalidateQueries({ queryKey: getGetAdminDashboardQueryKey() }); client.invalidateQueries({ queryKey: getGetLobbyQueryKey() }); };
  const onDecision = (id: string, decision: 'approve' | 'reject') => {
    setBusyId(id); setError('');
    decide.mutate({ transactionId: id, data: { decision } }, { onSuccess: () => done(id), onError: err => { setBusyId(''); setError(safeError(err)); } });
  };
  const onPaid = (id: string) => {
    setBusyId(id); setError('');
    complete.mutate({ transactionId: id }, { onSuccess: () => done(id), onError: err => { setBusyId(''); setError(safeError(err)); } });
  };
  return <AppFrame user={user}><main className="page">
    <div className="subpage-head"><div><div className="eyebrow">Operations / manual review</div><h1>Admin desk</h1><p>Review payment proofs and reconcile withdrawals. Every decision updates the player ledger.</p></div><button className="btn btn-soft btn-small" onClick={retry}><RefreshCw size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} />Refresh</button></div>
    <div className="admin-stats"><div className="stat-box"><span>Game rake</span><strong>{money(dashboard.totalGameRake)}</strong></div><div className="stat-box"><span>Withdrawal taxes</span><strong>{money(dashboard.totalWithdrawalTaxes)}</strong></div><div className="stat-box"><span>Pending requests</span><strong>{dashboard.pendingCount}</strong></div></div>
    {error && <div className="error-text" role="alert">{error}</div>}
    <AdminTable title="Deposit requests" rows={dashboard.deposits} kind="deposit" onDecision={onDecision} onPaid={onPaid} busyId={busyId} />
    <AdminTable title="Withdrawal requests" rows={dashboard.withdrawals} kind="withdrawal" onDecision={onDecision} onPaid={onPaid} busyId={busyId} />
  </main></AppFrame>;
}

function NotFoundPage() {
  return <AppFrame user={null}><main className="page"><div className="panel" style={{ margin: '70px auto', textAlign: 'center', maxWidth: 500 }}><div className="eyebrow">404 / no match</div><h1 className="font-display">This page is out of play.</h1><p>The page you are looking for does not exist.</p><Link href="/" className="btn btn-primary">Back to lobby</Link></div></main></AppFrame>;
}

function RoutedApp() {
  const session = useGetSession();
  const signedIn = Boolean(session.data?.user);
  const lobby = useGetLobby({ query: { enabled: signedIn, queryKey: getGetLobbyQueryKey(), retry: false } });
  const isAdmin = session.data?.user?.role === 'admin';
  const admin = useGetAdminDashboard({ query: { enabled: isAdmin, queryKey: getGetAdminDashboardQueryKey(), retry: false } });
  const [, setLocation] = useLocation();
  const [path] = useLocation();
  const user = session.data?.user ?? null;
  const sessionFail = session.isError && !signedIn;
  const authLoading = session.isLoading;
  const afterAuth = () => { setLocation('/'); };
  if (authLoading) return <AppFrame user={null}><LoadingState /></AppFrame>;
  if (!signedIn || sessionFail) return <AuthScreen onAuth={afterAuth} />;
  if (path === '/admin' && !isAdmin) return <AppFrame user={user}><main className="page"><div className="panel" style={{ margin: '50px auto', maxWidth: 520 }}><div className="eyebrow">Restricted area</div><h2>Admin access only</h2><p>This operations desk is available to admin accounts.</p><Link href="/" className="btn btn-primary">Return to lobby</Link></div></main></AppFrame>;
  if (path === '/admin') {
    if (admin.isLoading || !admin.data) return <AppFrame user={user}><LoadingState /></AppFrame>;
    if (admin.isError) return <AppFrame user={user}><main className="page"><QueryError retry={() => admin.refetch()} message={safeError(admin.error)} /></main></AppFrame>;
    return <AdminPage user={user!} dashboard={admin.data} retry={() => admin.refetch()} />;
  }
  if (lobby.isLoading || !lobby.data) return <AppFrame user={user}><LoadingState /></AppFrame>;
  if (lobby.isError) return <AppFrame user={user}><main className="page"><QueryError retry={() => lobby.refetch()} message={safeError(lobby.error)} /></main></AppFrame>;
  const data = lobby.data;
  return <Switch>
    <Route path="/"><Lobby user={data.user} wallet={data.wallet} games={data.games} transactions={data.transactions} matches={data.matches} retry={() => lobby.refetch()} /></Route>
    <Route path="/add-cash"><DepositPage user={data.user} balance={data.wallet.depositBalance} /></Route>
    <Route path="/withdraw"><WithdrawalPage user={data.user} balance={data.wallet.winningBalance} /></Route>
    <Route path="/games/:gameId"><GamePage user={data.user} games={data.games} wallet={data.wallet} retry={() => lobby.refetch()} /></Route>
    <Route component={NotFoundPage} />
  </Switch>;
}

function App() {
  return <QueryClientProvider client={queryClient}><RoutedApp /></QueryClientProvider>;
}

export default App;
