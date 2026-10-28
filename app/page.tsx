import { redirect } from 'next/navigation';

// Bosh sahifa — tashkilot pasporti (ariza shu yerdan boshlanadi)
export default function HomePage() {
  redirect('/pasport');
}
