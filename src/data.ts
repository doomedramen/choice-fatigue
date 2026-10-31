export const categories = ["Movies", "Shows", "Adult"] as const;
export type Category = (typeof categories)[number];

export interface MediaItem {
  id: string;
  title: string;
  year?: number;
  type: string;
  runtime: string;
  rating: string;
  genre: string[];
  /** Adult only: who is on screen (pairing:women, pairing:men, pairing:mixed, pairing:trans). Derived per fetch, never stored. */
  pairing?: string[];
  synopsis: string;
  artworkUrl?: string;
  backdropUrl?: string;
  palette: [string, string, string];
  art: string;
  label: string;
  category: Category;
  age?: number;
  contentFlags?: string[];
  requestable?: { provider: "tmdb"; mediaType: "movie" | "tv"; id: number };
}

export const media: MediaItem[] = [
  { id:"arrival", title:"Arrival", year:2016, type:"Movie", runtime:"1h 56m", rating:"7.9", genre:["Sci-fi", "Thoughtful"], synopsis:"A linguist is recruited by the military to communicate with alien lifeforms after twelve mysterious spacecraft appear around the world.", palette:["#b6c8c3","#304d54","#182f3b"], art:"mist", label:"A language beyond words", category:"Movies" },
  { id:"past-lives", title:"Past Lives", year:2023, type:"Movie", runtime:"1h 45m", rating:"7.8", genre:["Romance", "Drama"], synopsis:"Two deeply connected childhood friends are wrested apart after one family emigrates from South Korea. Decades later, they reunite for one fateful week.", palette:["#e7c7a2","#af7652","#503b36"], art:"sunset", label:"Some lives stay with us", category:"Movies" },
  { id:"moonlight", title:"Moonlight", year:2016, type:"Movie", runtime:"1h 51m", rating:"7.4", genre:["Drama", "Coming of age"], synopsis:"A young man grapples with his identity and sexuality while experiencing the everyday struggles of childhood, adolescence, and burgeoning adulthood.", palette:["#1d5471","#137994","#1a193c"], art:"ocean", label:"Who you become", category:"Movies" },
  { id:"perfect-days", title:"Perfect Days", year:2023, type:"Movie", runtime:"2h 4m", rating:"7.9", genre:["Drama", "Quiet"], synopsis:"Hirayama finds contentment in the simple rituals of his structured life in Tokyo, until a series of unexpected encounters reveal more of his past.", palette:["#c1a87f","#72815c","#263a36"], art:"leaves", label:"A little beauty, every day", category:"Movies" },
  { id:"the-bear", title:"The Bear", year:2022, type:"Series", runtime:"3 seasons", rating:"8.5", genre:["Comedy", "Drama"], synopsis:"A young chef from the fine-dining world returns to Chicago to run his family's sandwich shop, where he and his crew find family in the chaos.", palette:["#c3663c","#6d342d","#281d1c"], art:"heat", label:"Every second counts", category:"Shows" },
  { id:"severance", title:"Severance", year:2022, type:"Series", runtime:"2 seasons", rating:"8.7", genre:["Mystery", "Sci-fi"], synopsis:"Mark leads a team of office workers whose memories have been surgically divided between work and personal life. A mystery unfolds outside the office.", palette:["#a2b9a6","#496b61","#203d38"], art:"office", label:"Work is mysterious", category:"Shows" },
  { id:"fleabag", title:"Fleabag", year:2016, type:"Series", runtime:"2 seasons", rating:"8.7", genre:["Comedy", "Drama"], synopsis:"A sharp-witted, grief-riddled woman navigates life and love in London while breaking the fourth wall to let us in on every deliciously uncomfortable thought.", palette:["#a76d4c","#5b4b42","#29211f"], art:"portrait", label:"A little bit of a mess", category:"Shows" },
  { id:"blue-eye-samurai", title:"Blue Eye Samurai", year:2023, type:"Animated series", runtime:"1 season", rating:"8.7", genre:["Action", "Adventure"], synopsis:"A young warrior lives a life in disguise while seeking the master who made her an outcast in Edo-period Japan.", palette:["#df714a","#a62930","#4d2835"], art:"sun", label:"A blade in a closed world", category:"Shows" },
  { id:"spirited-away", title:"Spirited Away", year:2001, type:"Movie", runtime:"2h 5m", rating:"8.6", genre:["Fantasy", "Adventure"], synopsis:"During her family's move to the suburbs, a sullen 10-year-old wanders into a world ruled by gods, witches, and spirits.", palette:["#8fc5bb","#348d91","#1a4e63"], art:"cloud", label:"A world between worlds", category:"Movies" },
  { id:"your-name", title:"Your Name.", year:2016, type:"Movie", runtime:"1h 46m", rating:"8.4", genre:["Romance", "Fantasy"], synopsis:"Two teenagers share a profound, magical connection upon discovering they are swapping bodies. Things become more complicated when they decide to meet.", palette:["#ee956f","#8e5475","#313458"], art:"comet", label:"Somehow, I feel like I know you", category:"Movies" },
  { id:"the-handmaiden", title:"The Handmaiden", year:2016, type:"Movie", runtime:"2h 25m", rating:"8.1", genre:["Romance", "Thriller"], synopsis:"In 1930s Korea, a young woman is hired as a handmaiden to a Japanese heiress, but a secret plan sets events in motion.", palette:["#766c52","#a79876","#343527"], art:"garden", label:"A story told in three parts", category:"Adult", age:18 },
  { id:"in-the-mood", title:"In the Mood for Love", year:2000, type:"Movie", runtime:"1h 38m", rating:"8.1", genre:["Romance", "Drama"], synopsis:"Two neighbours form a strong bond after both suspect their spouses of infidelity. Quiet, adult themes; presented here without graphic imagery.", palette:["#9e3d2f","#561e28","#21161e"], art:"noir", label:"In another time, another place", category:"Adult", age:18 },
];
