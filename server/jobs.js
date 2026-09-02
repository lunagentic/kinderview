// 배치 실행 진입점.
//   npm run job:daily     마감·지연·외주 납품 알림
//   npm run job:weekly    Weekly Report 생성 + Slack 공유
//   npm run sync:slack    Slack 구성원 동기화
//
// 실제 운영에서는 cron 으로 건다.
//   0 0 * * 1-5   node server/jobs.js daily     (09:00 KST)
//   0 8 * * 5     node server/jobs.js weekly    (17:00 KST 금요일)

import { members } from './repo.js';
import * as notify from './notify.js';
import * as weekly from './weekly.js';
import * as slack from './slack.js';

const [, , command] = process.argv;

const run = async () => {
  switch (command) {
    case 'daily': {
      const result = await notify.runDailyJob();
      console.log(`[daily] ${result.date}`);
      for (const s of result.sent) console.log(`  ${s.kind.padEnd(20)} ${s.count}건`);
      break;
    }
    case 'weekly': {
      const report = weekly.generate({ by: 'system' });
      console.log(`[weekly] ${report.period_start} ~ ${report.period_end} 생성`);
      const shared = await notify.shareWeekly(report);
      console.log(`  Slack 공유: ${shared.status} → ${shared.channel}`);
      if (!shared.channel_configured) console.log('  SLACK_DEFAULT_CHANNEL 이 없어 알림함에만 기록했습니다.');
      break;
    }
    case 'sync-members': {
      if (!slack.isConfigured()) {
        console.log('SLACK_BOT_TOKEN 이 없습니다. 시드 구성원을 그대로 사용합니다.');
        break;
      }
      const list = await slack.fetchMembers();
      const result = members.syncAll(list);
      console.log(`[sync] 신규 ${result.added} · 갱신 ${result.updated} · 비활성 ${result.deactivated}`);
      break;
    }
    default:
      console.log('사용법: node server/jobs.js <daily|weekly|sync-members>');
      process.exitCode = 1;
  }
};

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
