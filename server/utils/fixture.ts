/**
 * 无密钥开发模式（NUXT_USE_FIXTURE=1）的内置样例：
 * 走完整 SSE 协议返回一份 30 条的海贼王战力榜，用于前端/动效验收。
 * 注意：名次与分数是演示数据，不代表真实结论。
 */
import type { RankingResult } from '#shared/ranking'

const SOURCE = 'https://onepiece.fandom.com/wiki'

interface Seed {
  name: string
  slug: string
  score: number
  note: string
  avatar?: string
}

const SEEDS: Seed[] = [
  { name: '蒙奇·D·路飞', slug: 'Monkey_D._Luffy', score: 99, note: '尼卡形态觉醒，和之国击败凯多，新世界的既成事实', avatar: 'https://static.wikia.nocookie.net/onepiece/images/l/luffy-gear5-demo.png' },
  { name: '香克斯（红发）', slug: 'Shanks', score: 97, note: '四皇之一，霸王色天花板级表现，几乎未全力出手', avatar: 'https://static.wikia.nocookie.net/onepiece/images/s/shanks-demo.png' },
  { name: '凯多', slug: 'Kaido', score: 95, note: '“最强生物”，旧时代百兽海贼团总督' },
  { name: '夏洛特·玲玲（BIG MOM）', slug: 'Charlotte_Linlin', score: 93, note: '四皇之一，灵魂果实与霸气的复合压制' },
  { name: '马歇尔·D·蒂姆（黑胡子）', slug: 'Marshall_D._Teach', score: 91, note: '双果实持有者，新晋四皇，上限争议极大' },
  { name: '爱德华·纽盖特（白胡子）', slug: 'Edward_Newgate', score: 89, note: '“世界最强男人”顶上战争表现，年龄折扣后排此' },
  { name: '哥尔·D·罗杰', slug: 'Gol_D._Roger', score: 88, note: '海贼王，与白胡子并称旧时代双顶点' },
  { name: '波特卡斯·D·艾斯', slug: 'Portgas_D._Ace', score: 86, note: '烧烧果实+白胡子二番队队长，顶上战争输出' },
  { name: '萨博', slug: 'Sabo', score: 85, note: '革命军参谋长，继承烧烧果实，德雷斯罗萨胜阿贝罗' },
  { name: '赤犬（萨卡斯基）', slug: 'Sakazuki', score: 84, note: '海军元帅，岩浆果实攻防一体，顶上战争主导者' },
  { name: '蒙奇·D·卡普', slug: 'Monkey_D._Garp', score: 83, note: '海军英雄，两次逼停罗杰，霸缠拳风破空' },
  { name: '尤斯塔斯·基德', slug: 'Eustass_Kid', score: 81, note: '磁磁果实+觉醒，和之国击败大妈船员集团' },
  { name: '特拉法尔加·罗', slug: 'Trafalgar_Law', score: 80, note: '手术果实觉醒，鬼岛斩凯多“王牌”' },
  { name: '藤虎（一笑）', slug: 'Issho', score: 79, note: '重力果实，德雷斯罗萨压路飞/罗联手' },
  { name: '青雉（库赞）', slug: 'Kuzan', score: 78, note: '冰冻果实，与赤犬十日为敌后淡出主线' },
  { name: '黄猿（波鲁萨利诺）', slug: 'Borsalino', score: 77, note: '闪闪果实，和之国“被迫认真”的名场面' },
  { name: '绿牛（荒牧）', slug: 'Ryokugyu', score: 76, note: '森森果实新大将，被霸缠凯多逼退' },
  { name: '巴索罗缪·熊', slug: 'Bartholomew_Kuma', score: 75, note: '暴君，肉球果实+和平主义者本体，剧情状态成谜' },
  { name: '金狮子史基', slug: 'Shiki', score: 74, note: '飘飘果实，与罗杰白胡子并称传说' },
  { name: '光月御田', slug: 'Kozuki_Oden', score: 73, note: '二刀流+霸王色，罗杰/白胡子船上受训' },
  { name: '烬（King）', slug: 'King', score: 72, note: '百兽团总大看板，古代种龙形态，海圆陆军情报总监' },
  { name: '马可', slug: 'Marco', score: 71, note: '不死鸟果实，白胡子船长 older 时代一番队队长' },
  { name: '卡塔库栗', slug: 'Charlotte_Katakuri', score: 70, note: '糯糯果实+预见未来，和路飞打成平手的败者口碑' },
  { name: '乔兹', slug: 'Diamond_Joz', score: 69, note: '闪亮果实钻石化，白胡子团三号战力' },
  { name: '比斯塔（花剑）', slug: 'Vista', score: 68, note: '白胡子五番队队长，拖住鹰眼的分量' },
  { name: '佩罗斯佩罗', slug: 'Perospero', score: 67, note: '糖果果实，BIG MOM 家长子' },
  { name: '杰克', slug: 'Jack', score: 66, note: '象象果实猛犸形态，凯多团“灾难”之一' },
  { name: '克洛克达尔', slug: 'Crocodile', score: 65, note: '沙沙果实，从巴洛克工作社到十字公会' },
  { name: '乔拉可尔·米霍克（鹰眼）', slug: 'Dracule_Mihawk', score: 64, note: '世界第一大剑豪，王七时代战力标尺' },
  { name: '斯摩格', slug: 'Smoker', score: 63, note: '烟雾果实+海楼石十手，将官里的常青追赶者' },
]

export const FIXTURE_RANKING: RankingResult = {
  title: '海贼王人物实力 TOP30（fixture 演示数据）',
  entries: SEEDS.map((seed, index) => ({
    rank: index + 1,
    name: seed.name,
    score: seed.score,
    oneLiner: `${seed.note}（注：fixture 演示数据）`,
    sources: [
      { title: `${seed.name} — One Piece Wiki`, url: `${SOURCE}/${seed.slug}` },
      { title: 'One Piece Power Scaling（社区共识）', url: 'https://onepiece.fandom.com/wiki/Power_Levels' },
    ],
    ...(seed.avatar ? { avatarUrl: seed.avatar } : {}),
  })),
}
