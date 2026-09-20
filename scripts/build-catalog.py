import json,re,hashlib
from pathlib import Path
root=Path(__file__).resolve().parents[1]
raw=json.loads((root/'.cache/wiki-source.json').read_text())
aliases={
'Interstellar':'星际穿越','Inception':'盗梦空间','The Grand Budapest Hotel':'布达佩斯大饭店','La La Land':'爱乐之城','Her':'她','The Truman Show':'楚门的世界','The Shawshank Redemption':'肖申克的救赎','The Godfather':'教父','The Matrix':'黑客帝国','The Dark Knight':'蝙蝠侠：黑暗骑士','Forrest Gump':'阿甘正传','Pulp Fiction':'低俗小说','Fight Club':'搏击俱乐部','Blade Runner':'银翼杀手','Blade Runner 2049':'银翼杀手2049','Arrival':'降临','Whiplash':'爆裂鼓手','The Secret Life of Walter Mitty':'白日梦想家','Eternal Sunshine of the Spotless Mind':'暖暖内含光','Lost in Translation':'迷失东京','Before Sunrise':'爱在黎明破晓前','Before Sunset':'爱在日落黄昏时','Before Midnight':'爱在午夜降临前','Little Miss Sunshine':'阳光小美女','The Pursuit of Happyness':'当幸福来敲门','Dead Poets Society':'死亡诗社','Good Will Hunting':'心灵捕手','Soul':'心灵奇旅','Coco':'寻梦环游记','WALL-E':'机器人总动员','Up':'飞屋环游记','Inside Out':'头脑特工队','Ratatouille':'美食总动员','Toy Story':'玩具总动员','Zootopia':'疯狂动物城','Fantastic Mr. Fox':'了不起的狐狸爸爸','Moonrise Kingdom':'月升王国','The Royal Tenenbaums':'天才一族','The French Dispatch':'法兰西特派','Isle of Dogs':'犬之岛','The Lighthouse':'灯塔','The Northman':'北欧人','Everything Everywhere All at Once':'瞬息全宇宙','The Fabelmans':'造梦之家','The Batman':'新蝙蝠侠','Dune':'沙丘','Dunkirk':'敦刻尔克','Tenet':'信条','Memento':'记忆碎片','The Prestige':'致命魔术','The Silence of the Lambs':'沉默的羔羊','Se7en':'七宗罪','Seven':'七宗罪','The Social Network':'社交网络','Gone Girl':'消失的爱人','The Curious Case of Benjamin Button':'本杰明·巴顿奇事','The Green Mile':'绿里奇迹','The Terminal':'幸福终点站','Catch Me If You Can':'猫鼠游戏','Amélie':'天使爱美丽','Amelie':'天使爱美丽','Singin\' in the Rain':'雨中曲','Casablanca':'卡萨布兰卡','Roman Holiday':'罗马假日','Breakfast at Tiffany\'s':'蒂凡尼的早餐','2001: A Space Odyssey':'2001太空漫游','The Shining':'闪灵','A Clockwork Orange':'发条橙','Taxi Driver':'出租车司机','The Tree of Life':'生命之树','Nomadland':'无依之地','The Florida Project':'佛罗里达乐园','Lady Bird':'伯德小姐','Little Women':'小妇人','Frances Ha':'弗兰西丝·哈','Paterson':'帕特森','Manchester by the Sea':'海边的曼彻斯特','Marriage Story':'婚姻故事','The Shape of Water':'水形物语','Big Fish':'大鱼','Edward Scissorhands':'剪刀手爱德华','The Nightmare Before Christmas':'圣诞夜惊魂','Coraline':'鬼妈妈','The Iron Giant':'钢铁巨人','The Incredibles':'超人总动员','Finding Nemo':'海底总动员','Paddington':'帕丁顿熊','Paddington 2':'帕丁顿熊2'}
# A source-linked American-film starter collection, not a global or current catalog.
valid=[];seen=set()
for m in raw:
 if not (1950<=m.get('year',0)<=2022 and m.get('extract') and len(m['extract'])>=150 and m.get('href')): continue
 key=(m['href'],m['year'])
 if key in seen:continue
 seen.add(key)
 valid.append(m)
# Prefer the bilingual selection, then newer and more complete records.
valid.sort(key=lambda m:(m['title'] in aliases,bool(m.get('thumbnail')),m['year']),reverse=True)
valid=valid[:6000]
out=[]
for m in valid:
 out.append({'id':hashlib.sha1((m['href']+str(m['year'])).encode()).hexdigest()[:12],'title':m['title'],'zh':aliases.get(m['title'],''),'year':m['year'],'genres':[{'Animated':'Animation'}.get(g,g) for g in m.get('genres',[])],'cast':m.get('cast',[])[:6],'overview':m['extract'],'poster':m.get('thumbnail') or '', 'source':'https://en.wikipedia.org/wiki/'+m['href'],'runtime':None,'rating':None,'provider':'Wikipedia'})
(root/'public/data/movies.json').write_text(json.dumps(out,ensure_ascii=False,separators=(',',':')))
print({'count':len(out),'bilingual':sum(bool(m['zh']) for m in out),'size':(root/'public/data/movies.json').stat().st_size})
