// Liste de mots français courants, sans accents (faciles à taper sur tous les claviers),
// utilisée pour générer des phrases de passe mémorisables.
// Les doublons éventuels sont retirés au chargement ; l'entropie est calculée sur la taille réelle.
const RAW = `
abeille abricot acier action adresse affiche agneau aigle aiguille aimant album alerte algue allure alpage amande
ambre amiral ampoule ananas ancre angle animal anneau antenne aquarium arbre arcade argent argile armoire arome
arrosoir artiste asperge atelier atlas atome auberge aurore autruche avenue aviron avocat avril badge bagage
baguette baie baleine balcon ballon bambou banane banc bandeau banjo banque barbe barque barrage bassin bateau
baton bazar beignet beret berger betail beurre biche bijou billard biscuit bison bistrot blason bocal bougie
bouleau bouquet boussole bouteille boxeur bracelet branche brebis brioche brise brochet brosse brouette brume
buffet buisson bureau cabane cabine cactus cadeau cadran cahier caillou calcul calme camion canard canal canape
canne canoe canon cantine capitaine caprice carafe caramel caravane carnet carotte carpe carreau carton cascade
casque castor cerise cerveau chalet chameau champ chanson chapeau charbon chariot chateau chaton chemin cheminee
chenille cheval cheveu chevre chiffre chocolat chouette ciboule cigale cinema cirque citron citrouille clairon
clavier cloche clown cobalt cochon coffre colibri colline colonne comete compas comptoir concert concombre condor
confiture copain coquille corail corbeau corde cornet costume coton coucou couleur coussin couteau crabe crayon
creme crepe criquet crochet crocus cuillere cuisine cuivre cyclone cygne dauphin degre delta dentelle desert
dessin diamant diapason dindon disque docteur domino donjon dragon drapeau dromadaire duvet echarpe eclair
ecorce ecran ecrou ecureuil edredon eglise elan elephant emeraude encre enigme epice epinard eponge equerre
erable escalier escargot espace etable etagere etoile eventail fable facteur falaise famille farine faucon fauteuil
fenetre fermier feuille ficelle figue filet flacon flamant flamme fleuve flocon flute foin fontaine foret forge
fougere fourmi fraise framboise frelon fresque frite fromage fusee galet galop gant garage gardien gateau gazelle
gazon geant gendarme genou girafe girouette glacier gland globe gomme gorille goutte grain grange graphe grenade
grenier grillon grotte guepard guitare hamac hamster hareng harpe hautbois herbe heron hibou hirondelle homard
horloge hublot huile huitre igloo image indigo insecte iris ivoire jaguar jambon jardin jasmin jeton jockey
jonquille journal joyau judo jumelle jungle jupe kayak kiosque koala laine lampe lapin laser lavande legume
lentille levier lezard libellule lierre limace lingot lion lisiere litchi livre loisir losange loupe loutre lucarne
lumiere lutin lynx madame magasin magie maillot maison manche mandarine mangue manteau marbre marche marmotte
marron masque matelas matin medaille melon menthe meteore meunier miel miroir mobile mouette moulin mouton
muguet muraille musee mystere nageur narcisse navire nectar neige nenuphar nid noisette nomade nuage nuance
oasis ocean odeur oeillet oignon oiseau olive ombre onde opale orage orange orchidee ordinateur oreiller orgue
origami ortie otarie ouragan ours outil ovale pagaie paille palmier pampa panda panier panneau papillon paquebot
parapluie parfum parasol passage pastel patate patin paume pavot pecheur peigne pelican pelouse pendule pepite
perle perroquet persil phare piano pigeon pilote piment pinceau pingouin pirate piscine pistache planete plateau
plume poivre polaire pomme pompier poney portail potager poterie poulpe poussin prairie prisme prune puzzle
pyjama pyramide quartz quiche racine radeau radis raisin rameau rateau reglisse renard requin rideau rivage
riviere robot rocher roseau roseraie rouleau ruban ruche ruisseau sablier sabot safran salade sapin sardine
satellite saule saumon savane savon scarabee seigle sentier serpent serre sifflet signal silence sirop soleil
sommet sorbet souris spatule sphinx statue sucre sultan sureau tablier tambour tamis tapis taupe teinte
telescope tempete tennis terrasse tetard theiere thon tigre tilleul tiroir toboggan tomate tonneau tonnerre
topaze torrent tortue toucan toupie tournesol train trefle tresor tribu tricot trompette tropique trottoir
truffe tulipe tunnel turban tuyau univers vague vallee vanille vapeur veilleur velours vent verger vernis viaduc
village violon vipere voilier volcan voyage wagon yaourt zebre zephyr zigzag
abri accord acrobate adagio agate aile alcove alouette amour ananas anchois anis annexe antique aquarelle arbitre
archer arena armure arpege artichaut asile astre atoll aubergine audace avalanche aventure averse badminton
balade balance balise ballet bambin bandit banquise baron barreau basilic batterie bauge bavard beaute belette
bermuda betterave biberon bille bivouac blague bleuet bobine bocage boheme bolide bonbon bonnet bordure bosquet
bouclier boudin bouee bougeoir boulanger boule bourgeon bourrasque boxe braise bretelle brigade brindille brocante
bronze brugnon bruine buche bulle cabas cacahuete cachalot cadet cafard cagoule caille calepin camarade camelia
camomille campagne cannelle capuche carabine cardan caresse cargo carillon carnaval carrosse cartable casserole
castagne cavalier cedre ceinture cellier cerceau cerf chacal chaland chaloupe chamois chandelle chanvre chaperon
charade charme chasseur chaudron chausson chevalet chicoree chimere chorale chou chrono cigogne cime citadelle
clairiere clementine clocher cocotte coffret colombe comedie concierge conte coq coquelicot cornemuse corsaire
cortege couronne courrier crapaud cratere crevette crinoline crique cristal croissant croquet cumin curieux cyprès
dahlia dalle danseur dattier debut decor dedale delice demain dentiste derive devise diable dinette diplome
dodo dolmen domaine dortoir douane dragee dune eau ebene echelle echo eclat ecluse ecole ecume effort elixir
email embrun emblème empire enclume enfance envol eolienne epee eperon epi equipe ermite escrime essaim estuaire
etang ete etincelle etoffe evasion fanfare farandole fauve fee fenouil festin feutre fiacre fidele filou flambeau
flaque fleuret flocage foire fondue fortune fougue foulard fourche fourneau fracas fregate frimas fronton fuseau
gaieté galaxie galerie galion gamelle garenne gargouille gaufre gavotte geyser gibier gingembre givre glaive
glycine goeland golfe gondole gong goulot gourde grelot griffon grimoire grive grondin guimauve guirlande hameau
hangar hanneton harmonie hautain hermine hetre histoire horizon houblon houle hydre hymne icone ile ilot infini
jacinthe jade jaillir javelot jetee joker jongleur jouet joute jujube jument kermesse kiwi labyrinthe lagon lagune
lampion landau lanterne larme lasso latte lavoir legende levain licorne lilas limonade linotte liqueur liseron
lotus louve luciole lundi luth lyre macaron madrier magnolia maillet malle mammouth mandoline manege mangeoire
manoir maquette marais marelle mariniere marmite marteau mascotte massif matelot mazurka meandre melodie menhir
mercredi merle merveille mesange meteo meule mimosa minuit mirabelle missive mistral mocassin moineau moisson
mollusque monocle montagne monument morille mosaique motte mousse mulot murmure musette myrtille nacelle nacre
nappe navet nebuleuse neon nougat nymphe oboe ocelot octave odyssee oeuvre ogre omelette opera orbite orfevre
orme ornement orteil osier ouate oursin ouvrage palace palette palissade panache panorama pantin papaye paradis
parchemin parquet partition patio pavillon pecan pelerin pelote penombre perche periple petale peuplier phalene
piano pieuvre pilier pinson pipeau pirogue pistil pivoine placard plaine planeur plantain plongeur pluie poeme
poignee poireau polka pommade porcelaine portique potion poulie pralin preau presage primevere prince proue
puits pupitre quadrille quai quenouille quintal radar rafale ragout raie rampe rapace rasoir ravin rayon recif
regate reine relais remous rempart renne repos retable reverie rivet roitelet romarin ronce rosace rosee rossignol
rotin roulotte rubis rumeur sable sacoche sagesse saison salamandre saline salon sanglier saphir sarcelle sarment
saturne sauterelle sautoir sequoia serein serinette sesame sextant silex silo sirene sloop socle sonate sorcier
sorgho soupir source spirale stade steppe stylo sucette sulky surf tablette taillis talisman tandem tanniere
tarte tasse tempo tendresse tenor terrier tiare tipi titan toile tonnelle torche totem toundra tourelle tramway
trapeze traineau tremplin trident trio troubadour trousse truite tutu typhon ukulele vaisseau valse vanneau
veranda verveine vestige vigie vignoble violette virgule vitrail vivier voile voltige voyelle yacht yeti zinc
amarre brasier cabestan clafoutis dirigeable escale farfadet fjord gabarit girolle grenat hublot lagopede
mangrove marelle nautile parterre pastille quinoa rebond sablon tarot tilde trombone vermeil volute
`;

export const WORDLIST_FR: readonly string[] = Array.from(
  new Set(
    RAW.split(/\s+/)
      .map((w) => w.trim().toLowerCase())
      .filter((w) => /^[a-z]{3,11}$/.test(w)),
  ),
);
