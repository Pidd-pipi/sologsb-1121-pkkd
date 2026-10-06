import { Tag } from 'antd';

export interface RoundTagProps {
  round: number;
  locked?: boolean;
}

/** 复查期次角标，被样地台账、复查比对页消费 */
export default function RoundTag({ round, locked = false }: RoundTagProps) {
  return (
    <Tag color={round > 1 ? 'geekblue' : 'default'} data-testid={`round-tag-${round}`}>
      第 {round} 期{locked ? ' · 已锁定' : ''}
    </Tag>
  );
}
