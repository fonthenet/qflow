// Short alias for /kitchen/<screenToken> — mirrors the /d → /display
// pattern so kitchen tablets can mount a friendly URL like
// qflo.net/kd/<token> without leaking the verbose /kitchen/ prefix.
import KitchenPage from '../../kitchen/[screenToken]/page';

interface ShortKitchenPageProps {
  params: Promise<{ screenToken: string }>;
}

export default function ShortKitchenPage(props: ShortKitchenPageProps) {
  return KitchenPage(props);
}
