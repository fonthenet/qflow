import DisplayPage from '../../display/[screenToken]/page';

interface ShortDisplayPageProps {
  params: Promise<{ screenToken: string }>;
}

export default function ShortDisplayPage(props: ShortDisplayPageProps) {
  return DisplayPage(props);
}
