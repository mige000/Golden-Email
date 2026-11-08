# Golden Email
#### A weekly email plan for businesses
Golden Email allows anyone to upload a CSV file of their business's customer purchase data and get the answers to: who should we email this week, what should the email say, and should we offer a discount, and how big can it be while still making money?
These answers are supported by customizable visualizations that show overviews of customer loyalty and where profits can be made. Golden Email helps businesses win back their customers and increase sales without sacrificing profit.

## Running the app
```bash
npm install
cp .env.example .env     # optional: add a free Gemini API key
npm run dev              # open http://localhost:5173
```
Optionally: Get a Gemini key at <https://aistudio.google.com/apikey> for AI-written emails. Copy your key and paste it in `.env` after GEMINI_API_KEY=

 If this the API key is skipped, there are templates that the email drafts default to. Everything will still work properly.

## Why I built this
I have personally seen how small business rely heavily on repeat customers. Finding new customers and spending money on advertisement is very costly, so returning customers are their best source of revenue. In light of this, I wanted to develop a solution that helps businesses keep their customer base active without sacrificing too much of their profits.

A plain data dashboard AI solution shows people their data but doesn't tell a business owner what action to actually take on a Monday morning. I wanted something that tells users exactly what decision to make and why it's the best choice, while still giving them a chance to input their own opinion. 

I thought about how promotional emails with discounts have enticed me to make purchases that I wouldn't have otherwise made, but also how businesses might send out mass discounts to customers who would have purchased at full price anyway. I wanted to use data to clearly show the different groups that customers fall under and how much discount each group should be offered to encourage loyalty without giving away too much for no reason.

I needed an interface that users would trust, so I wanted to be fully transparent about measurements versus assumptions. The way that customers respond to an email discount can't be directly seen through purchase data at first, so the app treats it as an editable assumption. Every number in the UI is tagged "Measured", "Assumed", or "Set by you" and comes from clear, explainable rules. Additionally, data can be messy and users might not be technical, so I wanted to be able to take in messy data and automatically assign column mappings with confidence levels and reasoning in plain english, giving users a simple interface to correct mistakes if needed. This way, any user can receive clear recommendations on how to win back their customers, understand exactly where the recommendations are coming from, and collect everything they need to take action. 

## What I'd do with more time
- I already have a holdout group that is not sent emails. The next step would be to add a feature where users can upload the next month's data and compare how customers responded with and without emails. Then this data can be used to improve calculations by replacing assumed success probabilities with real ones.
- Incorporate inventory and employee data that would give us the exact profit margin. Instead of putting an estimate on how much money is made per purchase, the app could calculate exactly how much things cost and provide more accurate suggestions.
- Add the ability to actually send emails from the app rather than just getting an email recipinet list and templates. I'd want users to send out their customized emails with a click of a button.
- AI is only used to draft emails right now, but its use in the app could be expanded to explaining discount recommendations or bringing up patterns it found in the data. 
