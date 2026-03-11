import { Button } from './ui/button';
import { navigate } from '../hooks/useRouter';

export function NotFoundPage() {
  return (
    <div className="py-20 text-center animate-fade-in">
      <h1 className="text-6xl font-bold text-zinc-200">404</h1>
      <p className="mt-2 text-sm text-zinc-500">This page doesn't exist</p>
      <Button className="mt-4" onClick={() => navigate('/')}>Go Home</Button>
    </div>
  );
}
